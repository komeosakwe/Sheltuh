// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import InlineReauth from "@/components/auth/InlineReauth";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";
import VerifyForm from "@/components/auth/VerifyForm";
import SubmitEventForm from "@/components/SubmitEventForm";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The browser's saved-details suggestions (email, passwords, one-time codes,
 * organisation) come from each field's autocomplete token, so the forms that
 * collect a person's own details must carry the right one, with a matching
 * type and inputMode. Fields about something else (search, event details,
 * admin filters) are deliberately not here. Organiser apply / join, the
 * public profile form, the member profile and invite accept check theirs in
 * their own test files.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("email=mia%40example.com"),
}));
vi.mock("@/lib/api/waitlist", () => ({
  joinWaitlist: vi.fn(),
  getWaitlistStatus: vi.fn(),
  leaveWaitlist: vi.fn(),
}));

afterEach(cleanup);

function renderSignedOut(ui: React.ReactNode) {
  return render(<FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined })}>{ui}</FakeAuthProvider>);
}

/** What a browser reads off a field to decide what to suggest. */
function fieldTraits(label: string | RegExp) {
  const el = screen.getByLabelText(label);
  return {
    autocomplete: el.getAttribute("autocomplete"),
    type: el.getAttribute("type"),
    inputMode: el.getAttribute("inputmode"),
    name: el.getAttribute("name"),
  };
}

const EMAIL = { autocomplete: "email", type: "email", inputMode: "email", name: "email" };

describe("sign in", () => {
  it("suggests the saved email and the saved password", () => {
    renderSignedOut(<LoginForm />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
    expect(fieldTraits("Password")).toEqual({ autocomplete: "current-password", type: "password", inputMode: null, name: "password" });
  });

  it("is a form, so the browser offers to save the password", () => {
    renderSignedOut(<LoginForm />);
    expect(screen.getByLabelText("Email").closest("form")).toBe(screen.getByLabelText("Password").closest("form"));
    expect(screen.getByLabelText("Email").closest("form")).not.toBeNull();
  });
});

describe("sign up", () => {
  it("offers the email, and a new password (not the saved one) in both password fields", () => {
    renderSignedOut(<SignupForm />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
    expect(fieldTraits("Password")).toEqual({ autocomplete: "new-password", type: "password", inputMode: null, name: "password" });
    expect(fieldTraits("Confirm password")).toEqual({
      autocomplete: "new-password",
      type: "password",
      inputMode: null,
      name: "confirmPassword",
    });
  });
});

describe("email verification code", () => {
  it("takes the email, and the code from the message as a numeric one-time code", () => {
    renderSignedOut(<VerifyForm />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
    expect(fieldTraits("Verification code")).toEqual({
      autocomplete: "one-time-code",
      type: "text",
      inputMode: "numeric",
      name: "code",
    });
  });
});

describe("password reset", () => {
  it("asks for the email, then the one-time code and a new password", async () => {
    renderSignedOut(<ForgotPasswordForm />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await waitFor(() => expect(screen.getByLabelText("Reset code")).toBeInTheDocument());
    expect(fieldTraits("Reset code")).toEqual({ autocomplete: "one-time-code", type: "text", inputMode: "numeric", name: "code" });
    expect(fieldTraits("New password")).toEqual({
      autocomplete: "new-password",
      type: "password",
      inputMode: null,
      name: "newPassword",
    });
  });
});

describe("sign in again inside another message", () => {
  it("suggests the saved email and password like the sign-in page", () => {
    renderSignedOut(<InlineReauth onSignedIn={vi.fn()} />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
    expect(fieldTraits("Password")).toEqual({ autocomplete: "current-password", type: "password", inputMode: null, name: "password" });
  });
});

describe("submit an event", () => {
  it("suggests the organisation and the contact email, but nothing for the event's own fields", () => {
    const { container } = render(<SubmitEventForm />);
    expect(fieldTraits("Organiser name")).toMatchObject({ autocomplete: "organization", type: "text" });
    expect(fieldTraits("Contact email")).toMatchObject({ autocomplete: "email", type: "email", inputMode: "email" });
    for (const id of ["eventTitle", "venue", "suburb"]) {
      expect(container.querySelector(`#${id}`)?.getAttribute("autocomplete")).toBeNull();
    }
  });
});

describe("waitlist / notify me", () => {
  it("suggests the saved email", () => {
    renderSignedOut(<WaitlistBlock eventId="neon-static" />);
    expect(fieldTraits("Email")).toEqual(EMAIL);
  });
});
