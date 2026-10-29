// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldsForAuthError } from "@/components/auth/AuthField";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import InlineReauth from "@/components/auth/InlineReauth";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";
import VerifyForm from "@/components/auth/VerifyForm";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/*
 * The sign-in, sign-up, verify and reset forms (WCAG 3.3.1, 3.3.3, 4.1.2,
 * 2.5.8): required fields are checked before Supabase is called, focus goes
 * to the first invalid field, which is aria-invalid and described by its
 * error, submit buttons stay focusable while busy, and the small text links
 * are 44px tap targets.
 */

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

afterEach(() => {
  cleanup();
  push.mockReset();
  searchParams = new URLSearchParams();
});

function renderWith(ui: ReactElement, overrides: Partial<AuthContextValue> = {}) {
  const auth = fakeAuthValue({ status: "signed-out", ...overrides });
  render(<FakeAuthProvider value={auth}>{ui}</FakeAuthProvider>);
  return auth;
}

/** The field's own error line, read through its aria-describedby. */
function describedBy(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

const pending = () => new Promise<undefined>(() => {});

describe("LoginForm", () => {
  it("checks for an empty email and password before calling Supabase, and focuses the first", async () => {
    const auth = renderWith(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(email)).toBe("Enter your email");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(password)).toBe("Enter your password");

    // Fixing the email leaves only the password: focus goes there.
    fireEvent.change(email, { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(document.activeElement).toBe(password));
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("a wrong email or password marks both fields, described by the error, and focuses the email", async () => {
    renderWith(<LoginForm />, { signIn: vi.fn().mockRejectedValue(new Error("Invalid login credentials")) });
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    fireEvent.change(email, { target: { value: "mia@example.com" } });
    fireEvent.change(password, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    for (const field of [email, password]) {
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(describedBy(field)).toBe("Invalid login credentials");
    }
    await waitFor(() => expect(document.activeElement).toBe(email));
  });

  it("a connection failure is shown but marks no field", async () => {
    renderWith(<LoginForm />, { signIn: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it("Sign in is busy while it works, not disabled, so it keeps focus, and a second press does nothing", async () => {
    const auth = renderWith(<LoginForm />, { signIn: vi.fn(pending) });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    const button = screen.getByRole("button", { name: "Sign in" });
    button.focus();
    fireEvent.click(button);

    const busy = await screen.findByRole("button", { name: "Signing in…" });
    expect(busy).toBe(button);
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    fireEvent.submit(busy.closest("form") as HTMLFormElement);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("Forgot password? is a 44px tap target", () => {
    renderWith(<LoginForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveClass("inline-flex", "min-h-11", "items-center");
  });
});

describe("SignupForm", () => {
  it("checks every field before calling Supabase, and focuses the first invalid one", async () => {
    const auth = renderWith(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(document.activeElement).toBe(password));
    expect(password).toHaveAttribute("aria-invalid", "true");
    // Its error first, then the rules it has to meet.
    expect(describedBy(password)).toMatch(/^Password doesn't meet the requirements\. \| At least 8 characters/);
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(screen.getByLabelText("Confirm password"))).toBe("Confirm your password");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("says when the passwords don't match, on the confirm field", async () => {
    renderWith(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Hunter222" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Hunter223" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    const confirm = screen.getByLabelText("Confirm password");
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(describedBy(confirm)).toBe("Passwords don't match.");
  });

  it("a server error about the account marks the email", async () => {
    renderWith(<SignupForm />, { signUp: vi.fn().mockRejectedValue(new Error("User already registered")) });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Hunter222" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Hunter222" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("User already registered");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(document.activeElement).toBe(email));
  });

  it("puts the privacy line above the Sign up button", () => {
    renderWith(<SignupForm />);
    const privacy = screen.getByRole("link", { name: "Privacy Policy" });
    const button = screen.getByRole("button", { name: "Sign up" });
    expect(privacy.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(button.closest("form") as HTMLElement).getByRole("link", { name: "Terms of Use" })).toBeInTheDocument();
  });
});

describe("VerifyForm", () => {
  it("asks for the code before calling Supabase", async () => {
    searchParams = new URLSearchParams("email=mia%40example.com");
    const auth = renderWith(<VerifyForm />);
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    const code = screen.getByLabelText("Verification code");
    await waitFor(() => expect(document.activeElement).toBe(code));
    expect(describedBy(code)).toBe("Enter the verification code");
    expect(auth.confirmSignUp).not.toHaveBeenCalled();
  });

  it("a rejected code marks the code field", async () => {
    searchParams = new URLSearchParams("email=mia%40example.com");
    renderWith(<VerifyForm />, { confirmSignUp: vi.fn().mockRejectedValue(new Error("Token has expired or is invalid")) });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Token has expired or is invalid");
    const code = screen.getByLabelText("Verification code");
    expect(code).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(document.activeElement).toBe(code));
  });

  it("Resend code is a 44px target, asks for the email instead of being disabled, and is busy while sending", async () => {
    let resolve!: () => void;
    const resend = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderWith(<VerifyForm />, { resendConfirmationCode: resend });
    const button = screen.getByRole("button", { name: "Resend code" });
    expect(button).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(describedBy(email)).toBe("Enter your email");
    expect(resend).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: "mia@example.com" } });
    button.focus();
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "Sending…" });
    expect(busy).toBe(button);
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(resend).toHaveBeenCalledTimes(1);

    resolve();
    expect(await screen.findByText("New code sent.")).toHaveAttribute("role", "status");
  });
});

describe("ForgotPasswordForm", () => {
  it("asks for the email before calling Supabase, then checks the code and new password", async () => {
    const auth = renderWith(<ForgotPasswordForm />);
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(describedBy(email)).toBe("Enter your email");
    expect(auth.forgotPassword).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    const code = await screen.findByLabelText("Reset code");
    expect(auth.forgotPassword).toHaveBeenCalledWith("mia@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(document.activeElement).toBe(code));
    expect(describedBy(code)).toBe("Enter the reset code");
    const newPassword = screen.getByLabelText("New password");
    expect(newPassword).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(newPassword)).toMatch(/^Enter your new password \| At least 8 characters/);
    expect(auth.confirmForgotPassword).not.toHaveBeenCalled();
  });

  it("Send reset code is busy while it works, not disabled", async () => {
    renderWith(<ForgotPasswordForm />, { forgotPassword: vi.fn(pending) });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    const busy = await screen.findByRole("button", { name: "Sending…" });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
  });
});

describe("InlineReauth", () => {
  it("asks for the password before calling Supabase, and focuses it", async () => {
    const signIn = vi.fn();
    renderWith(<InlineReauth expectedAccount={{ email: "owner@example.com" }} onSignedIn={vi.fn()} />, { signIn });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(document.activeElement).toBe(password));
    expect(describedBy(password)).toBe("Enter your password");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("wrong credentials mark both fields; with the email locked, focus goes to the password", async () => {
    renderWith(<InlineReauth expectedAccount={{ email: "owner@example.com" }} onSignedIn={vi.fn()} />, {
      signIn: vi.fn().mockRejectedValue(new Error("Invalid login credentials")),
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(document.activeElement).toBe(password));
  });

  it("Sign in is busy while it works, not disabled", async () => {
    renderWith(<InlineReauth onSignedIn={vi.fn()} />, { signIn: vi.fn(pending) });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const busy = await screen.findByRole("button", { name: "Signing in…" });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
  });
});

describe("fieldsForAuthError", () => {
  it.each<[string, string[]]>([
    ["Invalid login credentials", ["email", "password"]],
    ["Password should be at least 6 characters.", ["password"]],
    ["Token has expired or is invalid", ["code"]],
    ["User already registered", ["email"]],
    ["Email not confirmed", ["email"]],
    ["Failed to fetch", []],
    ["Email rate limit exceeded", []],
  ])("%s → %j", (message, fields) => {
    expect(fieldsForAuthError(message, ["email"])).toEqual(fields);
  });

  it("falls back to the form's guess for anything else", () => {
    expect(fieldsForAuthError("Something odd", ["code"])).toEqual(["code"]);
  });
});
