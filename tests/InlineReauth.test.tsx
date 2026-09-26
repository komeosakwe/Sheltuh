// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineReauth from "@/components/auth/InlineReauth";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

afterEach(cleanup);

describe("InlineReauth — the account guard behind session-expiry recovery", () => {
  it("signs in and calls onSignedIn when no expected account is pinned", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn })}>
        <InlineReauth onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith("me@example.com", "hunter2");
  });

  it("locks the email field to the expected account and accepts a matching sign-in", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn })}>
        <InlineReauth expectedEmail="owner@example.com" onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput).toHaveProperty("readOnly", true);
    expect(emailInput.value).toBe("owner@example.com");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it("rejects and signs back out when a different account signs in than the one the draft belongs to", async () => {
    // Prevents one user's unsaved draft from being submitted under a
    // different account: even if a caller bypasses the readOnly email
    // field (e.g. by dispatching a raw change event), a mismatched
    // sign-in is rejected rather than silently accepted.
    const signIn = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn();
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn, signOut })}>
        <InlineReauth expectedEmail="owner@example.com" onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "someone-else@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/different account/i);
  });

  it("shows the underlying error and does not call onSignedIn when sign-in itself fails", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("Incorrect username or password."));
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn })}>
        <InlineReauth expectedEmail="owner@example.com" onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password."));
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
