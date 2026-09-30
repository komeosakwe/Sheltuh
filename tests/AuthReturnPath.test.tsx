// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";
import VerifyForm from "@/components/auth/VerifyForm";
import { withNext } from "@/lib/safe-next-path";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

// The ?next= return path has to survive every hop: sign in -> sign up ->
// verify -> (signed in) back to the page, and sign in -> forgot password ->
// sign in -> back to the page.

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));

afterEach(() => {
  cleanup();
  push.mockReset();
  search = new URLSearchParams();
});

const NEXT = "/events/neon-static#whos-going";
const ENCODED = encodeURIComponent(NEXT);
const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined });

function renderWithAuth(ui: React.ReactNode, auth = signedOut()) {
  render(<FakeAuthProvider value={auth}>{ui}</FakeAuthProvider>);
  return auth;
}

describe("withNext", () => {
  it("adds a safe next, keeps other params, and drops an unsafe one", () => {
    expect(withNext("/signup", NEXT)).toBe(`/signup?next=${ENCODED}`);
    expect(withNext("/verify", NEXT, { email: "a+b@example.com" })).toBe(
      `/verify?email=a%2Bb%40example.com&next=${ENCODED}`,
    );
    expect(withNext("/signup", undefined)).toBe("/signup");
    expect(withNext("/signup", "/.//evil.example")).toBe("/signup");
    expect(withNext("/signup", "https://evil.example")).toBe("/signup");
  });
});

describe("LoginForm links", () => {
  it("carries next to Sign up and Forgot password", () => {
    renderWithAuth(<LoginForm next={NEXT} />);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", `/signup?next=${ENCODED}`);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      `/forgot-password?next=${ENCODED}`,
    );
  });

  it("doesn't pass an unsafe next along", () => {
    renderWithAuth(<LoginForm next="//evil.example" />);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
  });
});

describe("SignupForm", () => {
  it("sends the new account to /verify with its email and next, and links back to sign in with next", async () => {
    const auth = renderWithAuth(<SignupForm next={NEXT} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=${ENCODED}`);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Hunter22x" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Hunter22x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(auth.signUp).toHaveBeenCalledWith("mia@example.com", "Hunter22x");
    expect(push).toHaveBeenCalledWith(`/verify?email=mia%40example.com&next=${ENCODED}`);
  });
});

describe("VerifyForm", () => {
  async function verify() {
    renderWithAuth(<VerifyForm />);
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    return push.mock.calls[0][0];
  }

  it("goes to a safe next once verified", async () => {
    search = new URLSearchParams({ email: "mia@example.com", next: NEXT });
    expect(await verify()).toBe(NEXT);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", `/login?next=${ENCODED}`);
  });

  it.each([undefined, "//evil.example", "/.//evil.example", "https://evil.example"])(
    "falls back to the dashboard for next=%j",
    async (next) => {
      search = new URLSearchParams({ email: "mia@example.com", ...(next ? { next } : {}) });
      expect(await verify()).toBe("/dashboard");
    },
  );
});

describe("ForgotPasswordForm", () => {
  it("returns to sign in with next after resetting, and its Back link keeps next", async () => {
    const auth = renderWithAuth(<ForgotPasswordForm next={NEXT} />);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", `/login?next=${ENCODED}`);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    fireEvent.change(await screen.findByLabelText("Reset code"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Hunter22x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(auth.confirmForgotPassword).toHaveBeenCalledWith("mia@example.com", "123456", "Hunter22x");
    expect(push).toHaveBeenCalledWith(`/login?next=${ENCODED}`);
  });
});
