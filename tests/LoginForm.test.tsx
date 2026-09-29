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

  it("goes to the dashboard with no ?next=", async () => {
    expect(await signInWith(undefined)).toBe("/dashboard");
  });

  it.each(["//evil.example", "https://evil.example/x", "/\\evil.example", "javascript:alert(1)"])(
    "ignores an unsafe ?next= (%j) and goes to the dashboard",
    async (next) => {
      expect(await signInWith(next)).toBe("/dashboard");
    },
  );
});
