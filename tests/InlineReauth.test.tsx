// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineReauth from "@/components/auth/InlineReauth";
import type { AccountRef } from "@/lib/auth/account";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const realUserAgent = window.navigator.userAgent;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  Object.defineProperty(window.navigator, "userAgent", { value: realUserAgent, configurable: true });
  Reflect.deleteProperty(window.navigator, "standalone");
});

const OWNER: AccountRef = { userId: "user-owner", email: "owner@example.com" };

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
      <FakeAuthProvider value={fakeAuthValue({ signIn, status: "signed-out", email: undefined })}>
        <InlineReauth expectedAccount={OWNER} onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput).toHaveProperty("readOnly", true);
    expect(emailInput.value).toBe("owner@example.com");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it("rejects a different account signed in here, and signs it out of this browser only", async () => {
    // Prevents one user's unsaved draft from being submitted under a
    // different account: even if a caller bypasses the readOnly email
    // field (e.g. by dispatching a raw change event), a mismatched
    // sign-in is rejected rather than silently accepted. Local scope: the
    // account's sessions elsewhere are left alone.
    const signIn = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn();
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn, signOut, status: "signed-out", email: undefined })}>
        <InlineReauth expectedAccount={OWNER} onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "someone-else@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signOut).toHaveBeenCalledWith("local");
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/different account/i);
  });

  it("shows the underlying error and does not call onSignedIn when sign-in itself fails", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("Incorrect username or password."));
    const onSignedIn = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signIn, status: "signed-out", email: undefined })}>
        <InlineReauth expectedAccount={OWNER} onSignedIn={onSignedIn} />
      </FakeAuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password."));
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("says so while someone else is signed in (e.g. the host refused to submit as them), without signing them out", () => {
    const signOut = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ signOut, userId: "user-other", email: "other@example.com" })}>
        <InlineReauth expectedAccount={OWNER} onSignedIn={vi.fn()} />
      </FakeAuthProvider>,
    );
    expect(
      screen.getByText(
        "You're signed in as a different account than the one that started this draft. Sign in as owner@example.com to save it — signing in as anyone else won't be accepted.",
      ),
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("InlineReauth — signing in with Google or Apple in a new tab", () => {
  const SIGNED_OUT = { status: "signed-out", userId: undefined, email: undefined, accessToken: undefined } as const;

  /** Mounts with `initial`; `become` re-renders with another auth state, as a sign-in in another tab would. */
  function mount(
    initial: Partial<AuthContextValue>,
    { expected, flag = "google,apple" }: { expected?: AccountRef; flag?: string } = {},
  ) {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
    const onSignedIn = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const shared = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() };
    const tree = (auth: Partial<AuthContextValue>) => (
      <FakeAuthProvider value={fakeAuthValue({ ...shared, ...auth })}>
        <form onSubmit={onSubmit}>
          <InlineReauth expectedAccount={expected} onSignedIn={onSignedIn} />
        </form>
      </FakeAuthProvider>
    );
    const view = render(tree(initial));
    const become = (auth: Partial<AuthContextValue>) => act(() => view.rerender(tree(auth)));
    return { onSignedIn, onSubmit, ...shared, become };
  }

  const useNewTabLink = () => fireEvent.click(screen.getByRole("link", { name: "Sign in in a new tab" }));
  const owner = (overrides: Partial<AuthContextValue> = {}): Partial<AuthContextValue> => ({
    status: "signed-in",
    userId: "user-owner",
    email: "owner@example.com",
    accessToken: "owner-token",
    lastSignInAt: "2026-10-25T10:00:00Z",
    ...overrides,
  });

  it("offers /login in a new tab (ending on /signed-in), naming only the providers that are on, without submitting the outer form", () => {
    const { onSubmit } = mount(SIGNED_OUT);
    expect(screen.getByText(/^Signed in with Google or Apple\?/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Sign in in a new tab" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fsigned-in");
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

  it("in the iOS home-screen app (its new tabs open in Safari, apart from it), no link: says how it is instead", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    mount(SIGNED_OUT);
    expect(screen.queryByRole("link", { name: "Sign in in a new tab" })).toBeNull();
    expect(
      screen.getByText(
        "Signed in with Google or Apple? In the home-screen app, that sign-in can’t reach this page. Copy anything you want to keep, then sign in again with Sign in, at the top of the page or in the menu.",
      ),
    ).toBeInTheDocument();
  });

  it("says it's waiting once the link is used, in a polite live region, and clears it when the sign-in arrives", async () => {
    const { become, onSignedIn } = mount(SIGNED_OUT, { expected: OWNER });
    const live = screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite");
    expect(live).toBeEmptyDOMElement();

    useNewTabLink();
    expect(live).toHaveTextContent("Waiting for you to sign in in the other tab.");

    await become(owner());
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(live).toBeEmptyDOMElement());
  });

  it("never reacts to a sign-in in another tab unless the link was used", async () => {
    const { become, onSignedIn, signOut } = mount(SIGNED_OUT, { expected: OWNER });
    await become(owner());
    await become({ ...SIGNED_OUT });
    await become({ status: "signed-in", userId: "user-other", email: "other@example.com", accessToken: "t" });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("calls onSignedIn exactly once for the expected account's new sign-in; token refreshes never count", async () => {
    const { become, onSignedIn, signOut } = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();
    expect(onSignedIn).not.toHaveBeenCalled();

    await become(owner({ accessToken: "token-1" }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);

    // A refresh (a new token, same sign-in), or the same state again, never calls it a second time.
    await become(owner({ accessToken: "token-1" }));
    await become(owner({ accessToken: "token-2" }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keys on the sign-in, not the token: a refresh of a stale session is ignored, a new sign-in by the same account counts", async () => {
    // The session ran out without this tab hearing a sign-out (say, a refresh that failed on the network).
    const { become, onSignedIn } = mount(owner({ accessToken: "stale" }), { expected: OWNER });
    useNewTabLink();
    await become(owner({ accessToken: "refreshed" }));
    expect(onSignedIn).not.toHaveBeenCalled();

    await become(owner({ accessToken: "new", lastSignInAt: "2026-10-25T11:00:00Z" }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("accepts any new session when no account is pinned", async () => {
    const { become, onSignedIn } = mount(SIGNED_OUT);
    useNewTabLink();
    await become({ status: "signed-in", email: "anyone@example.com", accessToken: "token-1" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("refuses another account's session from the other tab: says so, moves focus there, and signs nobody out", async () => {
    const { become, onSignedIn, signOut } = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();

    await become({ status: "signed-in", userId: "user-other", email: "someone-else@example.com", accessToken: "their-token" });
    expect(signOut).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    const message = screen.getByText(/^You're signed in as a different account/);
    expect(message).toHaveTextContent("Sign in as owner@example.com to save it");
    await waitFor(() => expect(message).toHaveFocus());
    expect(message).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByText("Waiting for you to sign in in the other tab.")).toBeNull();

    // Still said while it's true (it isn't cleared by anything else happening here).
    await become({ status: "signed-in", userId: "user-other", email: "someone-else@example.com", accessToken: "refreshed" });
    expect(screen.getByText(/^You're signed in as a different account/)).toBeInTheDocument();

    // They sign out over there, and the right account signs in: accepted.
    await become(SIGNED_OUT);
    expect(screen.queryByText(/^You're signed in as a different account/)).toBeNull();
    await become(owner());
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("compares accounts by user id when both have one: a changed email is still the owner, a reused one isn't", async () => {
    const changed = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();
    await changed.become(owner({ email: "new-address@example.com" }));
    expect(changed.onSignedIn).toHaveBeenCalledTimes(1);
    cleanup();

    const reused = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();
    await reused.become(owner({ userId: "user-someone-else" }));
    expect(reused.onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByText(/^You're signed in as a different account/)).toBeInTheDocument();
  });

  it("does nothing for the session it mounted with, or the first one after loading", async () => {
    const signedIn = mount(owner({ accessToken: "stale" }), { expected: OWNER });
    useNewTabLink();
    await signedIn.become(owner({ accessToken: "stale" }));
    expect(signedIn.onSignedIn).not.toHaveBeenCalled();
    cleanup();

    const loading = mount({ status: "loading", email: undefined, accessToken: undefined }, { expected: OWNER });
    useNewTabLink();
    await loading.become(owner({ accessToken: "restored" }));
    expect(loading.onSignedIn).not.toHaveBeenCalled();
  });

  it("calls onSignedIn once for a password sign-in here, whenever its session reaches this component", async () => {
    // Its session arrives while the sign-in is still in flight...
    const during = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();
    during.signIn.mockImplementation(async () => {
      await during.become(owner({ accessToken: "password-token" }));
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(during.onSignedIn).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(during.onSignedIn).toHaveBeenCalledTimes(1);
    cleanup();

    // ...or only after it has finished.
    const after = mount(SIGNED_OUT, { expected: OWNER });
    useNewTabLink();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(after.onSignedIn).toHaveBeenCalledTimes(1));
    await after.become(owner({ accessToken: "password-token" }));
    expect(after.onSignedIn).toHaveBeenCalledTimes(1);
  });
});
