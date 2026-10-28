// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginForm from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/safe-next-path";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllEnvs();
});

describe("safeNextPath", () => {
  it.each([
    ["/events/neon-static", "/events/neon-static"],
    ["/account", "/account"],
    ["/events/x?y=1#whos-going", "/events/x?y=1#whos-going"],
    ["/a/../account", "/account"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"], // stays a path on this site
  ])("keeps the same-site path %j", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "events/x", // not rooted
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "/events\\..\\..\\evil",
    "https://evil.example",
    "javascript:alert(1)",
    " /events/x",
    "/.//evil.example", // dot segments resolve to "//evil.example"
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/events/x\u0000",
    `/${"a".repeat(3000)}`,
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});

async function signInWith(next: string | undefined) {
  const auth = fakeAuthValue({ status: "signed-out" });
  render(
    <FakeAuthProvider value={auth}>
      <LoginForm next={next} />
    </FakeAuthProvider>,
  );
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "hunter22");
  return push.mock.calls[0][0];
}

describe("LoginForm return path", () => {
  it("goes back to a safe ?next= path after signing in", async () => {
    expect(await signInWith("/events/neon-static")).toBe("/events/neon-static");
  });

  it("goes to the events feed with no ?next=", async () => {
    expect(await signInWith(undefined)).toBe("/events");
  });

  it.each([
    "//evil.example",
    "https://evil.example/x",
    "/\\evil.example",
    "javascript:alert(1)",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
  ])(
    "ignores an unsafe ?next= (%j) and goes to the events feed",
    async (next) => {
      expect(await signInWith(next)).toBe("/events");
    },
  );
});

describe("LoginForm: the no-password hint for Apple / Google accounts", () => {
  function renderLogin(flag: string, configured = true) {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", configured })}>
        <LoginForm />
      </FakeAuthProvider>,
    );
  }

  it("describes the password field with it when a provider is on, naming only the ones that are", () => {
    renderLogin("apple,google");
    const hint = screen.getByText(
      "Signed up with Google or Apple? Use the Google or Apple button above.",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", hint.id);
    cleanup();

    renderLogin("apple");
    expect(screen.getByText("Signed up with Apple? Use the Apple button above.")).toBeInTheDocument();
  });

  it("has no hint with no provider on", () => {
    renderLogin("");
    expect(screen.queryByText(/Signed up with/)).toBeNull();
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-describedby");
  });
});

describe("LoginForm: a wrong email or password, with Apple / Google offered", () => {
  function renderFailing(flag: string, message: string) {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", signIn: vi.fn().mockRejectedValue(new Error(message)) })}>
        <LoginForm />
      </FakeAuthProvider>,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("says to use the button for an account made with one (it has no password), marking both fields as before", async () => {
    renderFailing("google,apple", "Invalid login credentials");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email and password don’t match. If you signed up with Apple or Google, use that button above.",
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("names only the provider that's on", async () => {
    renderFailing("google", "Invalid login credentials");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email and password don’t match. If you signed up with Google, use that button above.",
    );
  });

  it("leaves every other error as it was, and that one too with no provider on", async () => {
    renderFailing("google,apple", "Email not confirmed");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email not confirmed");
    cleanup();

    renderFailing("", "Invalid login credentials");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
  });
});
