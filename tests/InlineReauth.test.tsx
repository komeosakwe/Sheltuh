// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineReauth from "@/components/auth/InlineReauth";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

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

describe("InlineReauth — signing in with Google or Apple in a new tab", () => {
  const SIGNED_OUT = { status: "signed-out", email: undefined, accessToken: undefined } as const;

  /** Mounts with `initial`; `become` re-renders with another auth state, as a sign-in in another tab would. */
  function mount(initial: Partial<AuthContextValue>, { expectedEmail, flag = "google,apple" }: { expectedEmail?: string; flag?: string } = {}) {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
    const onSignedIn = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const shared = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() };
    const tree = (auth: Partial<AuthContextValue>) => (
      <FakeAuthProvider value={fakeAuthValue({ ...shared, ...auth })}>
        <form onSubmit={onSubmit}>
          <InlineReauth expectedEmail={expectedEmail} onSignedIn={onSignedIn} />
        </form>
      </FakeAuthProvider>
    );
    const view = render(tree(initial));
    const become = (auth: Partial<AuthContextValue>) => act(() => view.rerender(tree(auth)));
    return { onSignedIn, onSubmit, ...shared, become };
  }

  it("offers a /login link in a new tab, naming only the providers that are on, without submitting the outer form", () => {
    const { onSubmit } = mount(SIGNED_OUT);
    expect(screen.getByText(/^Signed in with Google or Apple\?/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Sign in in a new tab" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");

    fireEvent.click(link);
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();

    mount(SIGNED_OUT, { flag: "google" });
    expect(screen.getByText(/^Signed in with Google\?/)).toBeInTheDocument();
  });

  it("has no new-tab link when no provider is on, or in demo mode", () => {
    mount(SIGNED_OUT, { flag: "" });
    expect(screen.queryByRole("link", { name: "Sign in in a new tab" })).toBeNull();
    cleanup();
    mount({ ...SIGNED_OUT, configured: false });
    expect(screen.queryByRole("link", { name: "Sign in in a new tab" })).toBeNull();
  });

  it("says it's waiting once the link is used, in a polite live region, and clears it when the sign-in arrives", async () => {
    const { become, onSignedIn } = mount(SIGNED_OUT, { expectedEmail: "owner@example.com" });
    const live = screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite");
    expect(live).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("link", { name: "Sign in in a new tab" }));
    expect(live).toHaveTextContent("Waiting for you to sign in in the other tab.");

    await become({ status: "signed-in", email: "owner@example.com", accessToken: "from-the-other-tab" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(live).toBeEmptyDOMElement());
  });

  it("calls onSignedIn exactly once when a new session for the expected account arrives from another tab", async () => {
    const { become, onSignedIn, signOut } = mount(SIGNED_OUT, { expectedEmail: "Owner@Example.com" });
    expect(onSignedIn).not.toHaveBeenCalled();

    await become({ status: "signed-in", email: "owner@example.com", accessToken: "token-1" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);

    // A refresh, or the same state again, never calls it a second time.
    await become({ status: "signed-in", email: "owner@example.com", accessToken: "token-1" });
    await become({ status: "signed-in", email: "owner@example.com", accessToken: "token-2" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("accepts any new session when no account is pinned", async () => {
    const { become, onSignedIn } = mount(SIGNED_OUT);
    await become({ status: "signed-in", email: "anyone@example.com", accessToken: "token-1" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("refuses another account's session from the other tab: the existing error, and signs it out", async () => {
    const { become, onSignedIn, signOut } = mount(SIGNED_OUT, { expectedEmail: "owner@example.com" });
    fireEvent.click(screen.getByRole("link", { name: "Sign in in a new tab" }));

    await become({ status: "signed-in", email: "someone-else@example.com", accessToken: "their-token" });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSignedIn).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/different account/i));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in as owner@example.com to save it");
    expect(screen.queryByText("Waiting for you to sign in in the other tab.")).toBeNull();

    // Signed out, then the right account signs in over there: accepted.
    await become(SIGNED_OUT);
    await become({ status: "signed-in", email: "owner@example.com", accessToken: "owner-token" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("does nothing for the session it mounted with, or the first one after loading", async () => {
    const signedIn = mount({ status: "signed-in", email: "owner@example.com", accessToken: "stale" }, { expectedEmail: "owner@example.com" });
    await signedIn.become({ status: "signed-in", email: "owner@example.com", accessToken: "stale" });
    expect(signedIn.onSignedIn).not.toHaveBeenCalled();
    cleanup();

    const loading = mount({ status: "loading", email: undefined, accessToken: undefined }, { expectedEmail: "owner@example.com" });
    await loading.become({ status: "signed-in", email: "owner@example.com", accessToken: "restored" });
    expect(loading.onSignedIn).not.toHaveBeenCalled();
  });

  it("calls onSignedIn once for a password sign-in here, whenever its session reaches this component", async () => {
    // Its session arrives while the sign-in is still in flight...
    const during = mount(SIGNED_OUT, { expectedEmail: "owner@example.com" });
    during.signIn.mockImplementation(async () => {
      await during.become({ status: "signed-in", email: "owner@example.com", accessToken: "password-token" });
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(during.onSignedIn).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(during.onSignedIn).toHaveBeenCalledTimes(1);
    cleanup();

    // ...or only after it has finished.
    const after = mount(SIGNED_OUT, { expectedEmail: "owner@example.com" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(after.onSignedIn).toHaveBeenCalledTimes(1));
    await after.become({ status: "signed-in", email: "owner@example.com", accessToken: "password-token" });
    expect(after.onSignedIn).toHaveBeenCalledTimes(1);
  });
});
