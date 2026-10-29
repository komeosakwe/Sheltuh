// @vitest-environment jsdom
import { AuthApiError } from "@supabase/supabase-js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InviteFlow from "@/components/invites/InviteFlow";
import { ApiError } from "@/lib/api/client";
import type { InviteView, MyInvite } from "@/lib/api/types";
import { OtherSessionsSignOutError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const viewInvite = vi.fn();
const getInviteAccountLink = vi.fn();
const getMyInvite = vi.fn();
const acceptInvite = vi.fn();
vi.mock("@/lib/api/invites", () => ({
  viewInvite: (...args: unknown[]) => viewInvite(...args),
  getInviteAccountLink: (...args: unknown[]) => getInviteAccountLink(...args),
  getMyInvite: (...args: unknown[]) => getMyInvite(...args),
  acceptInvite: (...args: unknown[]) => acceptInvite(...args),
}));

const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }) }));

const TOKEN = "Z".repeat(40) + "a_-";
const EXPIRES = "2026-11-08T01:00:00.000Z";

const ORGANISER_VIEW: InviteView = {
  kind: "organiser",
  maskedEmail: "m***@example.com",
  organiserName: "Neon Collective",
  expiresAt: EXPIRES,
  account: "new",
  passwordSetup: true,
};
const MEMBER_VIEW: InviteView = { kind: "member", maskedEmail: "m***@example.com", expiresAt: EXPIRES, account: "new", passwordSetup: true };
const ORGANISER_INVITE: MyInvite = { inviteId: "inv-1", kind: "organiser", organiserName: "Neon Collective", expiresAt: EXPIRES };
const MEMBER_INVITE: MyInvite = { inviteId: "inv-2", kind: "member", expiresAt: EXPIRES };

const NEW_INVITE_MAILTO = "mailto:support@sheltuh.com.au?subject=New%20invite%20link";
const SIGNED_IN_MIA: Partial<AuthContextValue> = { status: "signed-in", email: "mia@example.com", userId: "u-mia" };

const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", email: undefined, userId: undefined, accessToken: undefined };

/**
 * Renders the page under an auth value the test can change, as AuthProvider's would:
 * its signOut signs out (local), like the real one. Its functions are the same
 * mocks on every render (`controls.auth`).
 */
function renderFlow(initial: Partial<AuthContextValue> = SIGNED_OUT, { at = `/invite#token=${TOKEN}` } = {}) {
  window.history.replaceState(null, "", at);
  const signOut = vi.fn();
  const fns = {
    verifyInvite: vi.fn<AuthContextValue["verifyInvite"]>().mockResolvedValue(undefined),
    setNewPassword: vi.fn<AuthContextValue["setNewPassword"]>().mockResolvedValue(undefined),
    getAccessToken: vi.fn<AuthContextValue["getAccessToken"]>().mockResolvedValue("fake-access-token"),
  };
  const controls: { set?: (overrides: Partial<AuthContextValue>) => void; auth: typeof fns } = { auth: fns };
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<AuthContextValue>>(initial);
    controls.set = (next) => setOverrides((prev) => ({ ...prev, ...next }));
    const value = fakeAuthValue({
      ...overrides,
      ...fns,
      signOut: (scope) => {
        signOut(scope);
        setOverrides((prev) => ({ ...prev, ...SIGNED_OUT }));
      },
    });
    return (
      <FakeAuthProvider value={value}>
        <InviteFlow />
      </FakeAuthProvider>
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  return { signOut, controls };
}

async function fillPassword(password = "Secret123") {
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: password } });
}

beforeEach(() => {
  api.configured = true;
  for (const fn of [viewInvite, getInviteAccountLink, getMyInvite, acceptInvite, push]) fn.mockReset();
  getMyInvite.mockRejectedValue(new ApiError(404, "There's no invite waiting for this account's email address."));
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("/invite: before anything is pressed", () => {
  it("in the demo, says invites work on the live site and calls nothing", async () => {
    api.configured = false;
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Invites work on the live site" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("can’t be opened in this demo");
    expect(viewInvite).not.toHaveBeenCalled();
  });

  it("without a token (signed out), says the link is incomplete, focuses that, and offers to sign in back here", async () => {
    renderFlow(SIGNED_OUT, { at: "/invite" });
    const heading = await screen.findByRole("heading", { level: 1, name: "This invite link is incomplete" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Finvite");
    expect(viewInvite).not.toHaveBeenCalled();
  });

  it("reads the invite once, removes the token from the address bar, and shows what it's for", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    renderFlow();
    const heading = await screen.findByRole("heading", { level: 1, name: "Set up Neon Collective on Sheltüh" });
    expect(heading).toHaveAccessibleDescription(/as Neon Collective\. For m\*\*\*@example\.com, valid until/);
    expect(viewInvite).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/invite");
    // Nothing else happens until a button is pressed.
    expect(getInviteAccountLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Finvite");
  });

  it("an invalid link says so, focused", async () => {
    viewInvite.mockRejectedValue(new ApiError(404, "This invite link isn't valid."));
    renderFlow();
    const heading = await screen.findByRole("heading", { level: 1, name: "This invite link isn’t valid" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Email support@sheltuh.com.au" })).toHaveAttribute("href", NEW_INVITE_MAILTO);
  });

  it.each([
    ["expired", "This invite has expired", /Ask the Sheltüh team to send you a new one/],
    ["revoked", "This invite has been withdrawn", /Contact the Sheltüh team/],
    ["used", "This invite has already been used", /Sign in to continue/],
  ] as const)("a %s invite (410) says so in its own words, focused", async (code, title, message) => {
    viewInvite.mockRejectedValue(new ApiError(410, "Gone.", undefined, { error: "Gone.", code }));
    renderFlow();
    const heading = await screen.findByRole("heading", { level: 1, name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(message);
    if (code === "used") {
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Finvite");
      expect(screen.queryByRole("link", { name: /^Email / })).toBeNull();
    } else {
      // How to reach the team, with the subject filled in.
      expect(screen.getByRole("link", { name: "Email support@sheltuh.com.au" })).toHaveAttribute("href", NEW_INVITE_MAILTO);
    }
  });

  it("a used invite, signed in: on to their account (not the dashboard, which is an organiser's)", async () => {
    viewInvite.mockRejectedValue(new ApiError(410, "Gone.", undefined, { error: "Gone.", code: "used" }));
    renderFlow(SIGNED_IN_MIA);
    expect(await screen.findByRole("heading", { level: 1, name: "This invite has already been used" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Go to your dashboard" })).toBeNull();
  });

  it("a connection failure can be tried again", async () => {
    viewInvite.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server.")).mockResolvedValue(MEMBER_VIEW);
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh" })).toBeInTheDocument();
    expect(viewInvite).toHaveBeenCalledTimes(2);
  });

  it("the same failure again after Try again: the heading takes focus again, so it's read out", async () => {
    viewInvite.mockRejectedValue(new ApiError(0, "Couldn't reach the server."));
    renderFlow();
    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toHaveFocus());
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(viewInvite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toHaveFocus());
  });

  it("an address with an account signs in, coming back here", async () => {
    viewInvite.mockResolvedValue({ ...ORGANISER_VIEW, account: "existing" });
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to accept your invite" })).toHaveAccessibleDescription(
      /m\*\*\*@example\.com already has an account/,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Finvite");
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password?next=%2Finvite");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("an unconfirmed account for the address is finished by a password reset, never the sign-up", async () => {
    viewInvite.mockResolvedValue({ ...ORGANISER_VIEW, account: "unconfirmed", passwordSetup: false });
    renderFlow();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Reset your password to accept your invite" }),
    ).toHaveAccessibleDescription(/m\*\*\*@example\.com was never confirmed/);
    expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute("href", "/forgot-password?next=%2Finvite");
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("with password setup on, an unconfirmed account is replaced by the server: the normal Create account form", async () => {
    viewInvite.mockResolvedValue({ ...ORGANISER_VIEW, account: "unconfirmed", passwordSetup: true });
    renderFlow();
    expect(await screen.findByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reset password" })).toBeNull();
  });

  it("without password setup (no key), sends a new address to the ordinary sign-up, coming back here", async () => {
    viewInvite.mockResolvedValue({ ...MEMBER_VIEW, passwordSetup: false });
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup?next=%2Finvite");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });
});

describe("/invite: Create account", () => {
  it("checks the password first, calling nothing, and focuses the field; there is no confirm field", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    renderFlow();
    await fillPassword("secret");
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveAccessibleDescription(/^Password doesn't meet the requirements\./);
    expect(getInviteAccountLink).not.toHaveBeenCalled();
  });

  it("organiser: account-link → verifyInvite → setNewPassword, then Join (focused) → accept → the dashboard", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-1" });
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    acceptInvite.mockResolvedValue({ kind: "organiser", organiserId: "org-9" });
    const { controls } = renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    const join = await screen.findByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" });
    await waitFor(() => expect(join).toHaveFocus());
    const value = controls.auth;
    expect(getInviteAccountLink).toHaveBeenCalledWith(TOKEN);
    expect(value.verifyInvite).toHaveBeenCalledWith("hash-1");
    expect(value.setNewPassword).toHaveBeenCalledWith("Secret123");
    const order = [
      getInviteAccountLink.mock.invocationCallOrder[0],
      value.verifyInvite.mock.invocationCallOrder[0],
      value.setNewPassword.mock.invocationCallOrder[0],
      getMyInvite.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // An organiser invite waits for Join, with the Terms.
    expect(acceptInvite).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");

    fireEvent.click(screen.getByRole("button", { name: "Join as Neon Collective" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You’re in" })).toBeInTheDocument();
    expect(acceptInvite).toHaveBeenCalledWith("inv-1", value.getAccessToken);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("member: accepted straight after the account is created", async () => {
    viewInvite.mockResolvedValue(MEMBER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-2" });
    getMyInvite.mockReset().mockResolvedValue(MEMBER_INVITE);
    acceptInvite.mockResolvedValue({ kind: "member" });
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const done = await screen.findByRole("heading", { level: 1, name: "You’re in" });
    await waitFor(() => expect(done).toHaveFocus());
    expect(acceptInvite).toHaveBeenCalledWith("inv-2", expect.any(Function));
    expect(screen.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/events");
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["a server fault", new ApiError(500, "Internal server error")],
    ["no connection", new ApiError(0, "Failed to fetch")],
  ])("member: accepting straight away fails (%s): the Accept step opens saying so, in our words", async (_what, error) => {
    viewInvite.mockResolvedValue(MEMBER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-2" });
    getMyInvite.mockReset().mockResolvedValue(MEMBER_INVITE);
    acceptInvite.mockRejectedValueOnce(error).mockResolvedValue({ kind: "member" });
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Accept your invite" });
    await waitFor(() => expect(heading).toHaveFocus());
    // Focus lands on the heading: it's described by the intro and the error, so both are read.
    expect(heading).toHaveAccessibleDescription(
      /^Finishes setting up .* We couldn’t accept your invite just now\. Try again in a moment\.$/,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(error.message);
    expect(screen.getByText(/^By accepting, you agree/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You’re in" })).toBeInTheDocument();
  });

  it("an expired sign-up token (otp_expired) is explained, and Create account asks for a new one", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-1" });
    const { controls } = renderFlow();
    const value = controls.auth;
    value.verifyInvite.mockRejectedValueOnce(new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"));
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sign-up link we made for you expired before it could be used. Press Create account to try again.",
    );
    expect(value.setNewPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(getInviteAccountLink).toHaveBeenCalledTimes(2));
  });

  it("once verified, a refused password is retried on its own (Save password), never a second account link", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-1" });
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    const { controls } = renderFlow();
    const value = controls.auth;
    value.setNewPassword.mockRejectedValueOnce(
      new AuthApiError("Password is known to be weak and easy to guess", 422, "weak_password"),
    );
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is set up, but its password wasn’t saved: Password is known to be weak and easy to guess. Choose a different password, then press Save password.",
    );
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveAttribute("aria-invalid", "true");
    // The account exists now: signing in to another isn't the way on.
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    await fillPassword("Better456x");
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" })).toBeInTheDocument();
    expect(getInviteAccountLink).toHaveBeenCalledTimes(1);
    expect(value.verifyInvite).toHaveBeenCalledTimes(1);
    expect(value.setNewPassword).toHaveBeenLastCalledWith("Better456x");
  });

  it("other sessions not signed out: says the password was saved, and Save password only retries that", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-1" });
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    const { controls } = renderFlow();
    const value = controls.auth;
    value.setNewPassword.mockRejectedValueOnce(new OtherSessionsSignOutError(new AuthApiError("Server error", 500, "unexpected_failure")));
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your password was saved, but we couldn’t sign out your other sessions. Press Save password to try again.");
    expect(alert).not.toHaveTextContent("wasn’t saved");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" })).toBeInTheDocument();
    expect(value.setNewPassword).toHaveBeenCalledTimes(2);
    expect(getInviteAccountLink).toHaveBeenCalledTimes(1);
  });

  it("409 has_account: on to signing in, its heading and intro saying why (no second notice)", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockRejectedValue(
      new ApiError(409, "This email address already has a Sheltüh account.", undefined, { code: "has_account" }),
    );
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Sign in to accept your invite" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(/m\*\*\*@example\.com already has an account/);
    expect(screen.queryByText("This email address already has a Sheltüh account.")).toBeNull();
  });

  it("503 unavailable: falls back to the ordinary sign-up", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockRejectedValue(
      new ApiError(503, "We can't set up your account from here right now.", undefined, { code: "unavailable" }),
    );
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("We can't set up your account from here right now.")).toBeInTheDocument();
    expect(viewInvite).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup?next=%2Finvite");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("503 then an unconfirmed account (read again): a password reset, not the sign-up", async () => {
    viewInvite.mockResolvedValueOnce(ORGANISER_VIEW).mockResolvedValue({ ...ORGANISER_VIEW, account: "unconfirmed", passwordSetup: false });
    getInviteAccountLink.mockRejectedValue(new ApiError(503, "We can't set up your account from here right now.", undefined, { code: "unavailable" }));
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Reset your password to accept your invite" });
    await waitFor(() => expect(heading).toHaveFocus());
    // Our words, not the 503's (which point at the sign-up form this account can't use).
    expect(screen.getByText("We couldn’t set up your account from here, so reset its password instead.")).toBeInTheDocument();
    expect(screen.queryByText("We can't set up your account from here right now.")).toBeNull();
    expect(viewInvite).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute("href", "/forgot-password?next=%2Finvite");
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
  });

  it("410 while creating: the invite's own screen", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockRejectedValue(new ApiError(410, "Withdrawn.", undefined, { code: "revoked" }));
    renderFlow();
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "This invite has been withdrawn" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("keeps the form on screen while the new account signs in mid-step", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getInviteAccountLink.mockResolvedValue({ tokenHash: "hash-1" });
    let release: () => void = () => {};
    const { controls } = renderFlow();
    const value = controls.auth;
    value.setNewPassword.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(controls.auth.setNewPassword).toHaveBeenCalled());
    // verifyOtp signed the new account in.
    act(() => controls.set?.({ status: "signed-in", email: "mia@example.com", userId: "u-new" }));
    expect(screen.getByRole("button", { name: "Saving password…" })).toBeInTheDocument();
    expect(getMyInvite).not.toHaveBeenCalled();
    await act(async () => release());
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" })).toBeInTheDocument();
  });
});

describe("/invite: signed in", () => {
  it("as someone else: says who, and signs out (this browser only) on request, never on its own", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    const { signOut } = renderFlow({ status: "signed-in", email: "other@example.com", userId: "u-other" });
    const heading = await screen.findByRole("heading", { level: 1, name: "You’re signed in as other@example.com" });
    expect(heading).toHaveAccessibleDescription("This invite is for m***@example.com. Sign out to continue.");
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Keep using this account" })).toHaveAttribute("href", "/events");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith("local");
    const next = await screen.findByRole("heading", { level: 1, name: "Set up Neon Collective on Sheltüh" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(viewInvite).toHaveBeenCalledTimes(1);
  });

  it("with another invite of their own, it's still someone else's link", async () => {
    viewInvite.mockResolvedValue(ORGANISER_VIEW);
    getMyInvite.mockReset().mockResolvedValue(MEMBER_INVITE);
    renderFlow({ status: "signed-in", email: "other@example.com", userId: "u-other" });
    expect(await screen.findByRole("heading", { level: 1, name: "You’re signed in as other@example.com" })).toBeInTheDocument();
  });

  it("back from signing in (no token): finds the invite by the account and offers Join", async () => {
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    acceptInvite.mockResolvedValue({ kind: "organiser", organiserId: "org-9" });
    renderFlow({ status: "signed-in", email: "mia@example.com", userId: "u-mia" }, { at: "/invite" });
    expect(await screen.findByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" })).toHaveAccessibleDescription(
      /approved organiser on mia@example\.com/,
    );
    expect(viewInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Join as Neon Collective" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("with the invite's own link and account: Join", async () => {
    viewInvite.mockResolvedValue(MEMBER_VIEW);
    getMyInvite.mockReset().mockResolvedValue(MEMBER_INVITE);
    acceptInvite.mockResolvedValue({ kind: "member" });
    renderFlow({ status: "signed-in", email: "mia@example.com", userId: "u-mia" });
    fireEvent.click(await screen.findByRole("button", { name: "Accept invite" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You’re in" })).toBeInTheDocument();
  });

  it("a link a resend replaced (404), signed in with the invite's account: the invite waiting for it, to accept", async () => {
    viewInvite.mockRejectedValue(new ApiError(404, "This invite link isn't valid."));
    getMyInvite.mockReset().mockResolvedValue(MEMBER_INVITE);
    renderFlow(SIGNED_IN_MIA);
    expect(await screen.findByRole("heading", { level: 1, name: "Accept your invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept invite" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This invite link isn’t valid" })).toBeNull();
  });

  it("an invalid link (404), signed in, with no invite for the account: the invalid link", async () => {
    viewInvite.mockRejectedValue(new ApiError(404, "This invite link isn't valid."));
    renderFlow(SIGNED_IN_MIA);
    const heading = await screen.findByRole("heading", { level: 1, name: "This invite link isn’t valid" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(getMyInvite).toHaveBeenCalled();
  });

  it("no invite for the account (no token): says so, with Sign out", async () => {
    const { signOut } = renderFlow({ status: "signed-in", email: "mia@example.com", userId: "u-mia" }, { at: "/invite" });
    expect(await screen.findByRole("heading", { level: 1, name: "No invite for this account" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith("local");
  });

  it("Join's refusals: one the invite can't survive is its own screen; anything else is said beside the button", async () => {
    getMyInvite.mockReset().mockResolvedValue(ORGANISER_INVITE);
    acceptInvite
      .mockRejectedValueOnce(new ApiError(409, "Your account already has an organiser profile."))
      .mockRejectedValueOnce(new ApiError(410, "Expired.", undefined, { code: "expired" }));
    renderFlow({ status: "signed-in", email: "mia@example.com", userId: "u-mia" }, { at: "/invite" });
    expect(await screen.findByText(/^By joining, you agree/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join as Neon Collective" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your account already has an organiser profile.");
    // Only the team can sort this out: how to reach them.
    expect(within(alert).getByRole("link", { name: "Email support@sheltuh.com.au" })).toHaveAttribute(
      "href",
      "mailto:support@sheltuh.com.au?subject=Invite%3A%20my%20account%20already%20has%20an%20organiser",
    );
    fireEvent.click(screen.getByRole("button", { name: "Join as Neon Collective" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "This invite has expired" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });
});
