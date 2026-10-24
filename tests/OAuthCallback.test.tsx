// @vitest-environment jsdom
import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OAuthCallback from "@/components/auth/OAuthCallback";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const replace = vi.fn();
const router = { replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
  window.history.replaceState(null, "", "/");
});

const signedOut = (overrides: Partial<AuthContextValue> = {}) =>
  fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined, ...overrides });

/** Opens /auth/callback with this query and fragment (jsdom's real location and history), in StrictMode. */
function open(url: string, auth: AuthContextValue) {
  window.history.replaceState(null, "", url);
  return render(
    <StrictMode>
      <FakeAuthProvider value={auth}>
        <OAuthCallback />
      </FakeAuthProvider>
    </StrictMode>,
  );
}

describe("OAuthCallback: a code", () => {
  it("exchanges it once (StrictMode runs the effect twice), clears the URL, then goes to next", async () => {
    const auth = signedOut();
    open("/auth/callback?next=%2Fevents%2Fneon-static%23whos-going&code=3f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", auth);
    expect(window.location.pathname).toBe("/auth/callback");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/events/neon-static#whos-going"));
    expect(auth.completeOAuthSignIn).toHaveBeenCalledTimes(1);
    expect(auth.completeOAuthSignIn).toHaveBeenCalledWith("3f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f");
    expect(replace).toHaveBeenCalledTimes(1);
    // The second run doesn't re-read the (now empty) URL and call it a broken link.
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
    expect(screen.queryByRole("heading", { name: "This sign-in link didn’t work" })).toBeNull();
  });

  it("says it's signing in (a polite status) while the exchange runs", async () => {
    let finish: () => void = () => {};
    const auth = signedOut({ completeOAuthSignIn: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) });
    open("/auth/callback?code=abc", auth);
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Signing in");
    expect(replace).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("goes to the dashboard with no next", async () => {
    open("/auth/callback?code=abc", signedOut());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it.each(["%2F%2Fevil.example", "https%3A%2F%2Fevil.example%2F", "javascript%3Aalert(1)", "%2Fauth%2Fcallback%3Fcode%3Dx"])(
    "ignores an unsafe or /auth next (%s): the dashboard instead",
    async (next) => {
      open(`/auth/callback?code=abc&next=${next}`, signedOut());
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    },
  );

  it("doesn't navigate if the page has gone before the exchange finishes", async () => {
    let finish: () => void = () => {};
    const auth = signedOut({ completeOAuthSignIn: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) });
    const { unmount } = open("/auth/callback?code=abc", auth);
    await waitFor(() => expect(auth.completeOAuthSignIn).toHaveBeenCalledTimes(1));
    unmount();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("OAuthCallback: errors", () => {
  it.each([
    ["?error=access_denied", "", "Sign-in cancelled"],
    ["", "#error=user_cancelled_authorize", "Sign-in cancelled"],
    ["?error=access_denied&error_code=user_banned", "", "This account can’t sign in"],
    ["?error=access_denied&error_code=signup_disabled", "", "New accounts are paused"],
    ["", "#error=access_denied&error_code=provider_email_needs_verification&sb=", "Verify your email first"],
    ["?error=server_error&error_code=unexpected_failure", "", "Something went wrong signing in"],
    ["", "", "This sign-in link didn’t work"],
  ])("from the URL (%s%s): shows %j, focused, and exchanges nothing", async (search, hash, title) => {
    const auth = signedOut();
    open(`/auth/callback${search}${hash}`, auth);
    const heading = await screen.findByRole("heading", { level: 1, name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(auth.completeOAuthSignIn).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search + window.location.hash).toBe("");
  });

  it.each([
    [new AuthPKCECodeVerifierMissingError(), "Start again in this browser"],
    [new AuthApiError("Flow state has expired", 403, "flow_state_expired"), "This sign-in has expired"],
    [new AuthApiError("invalid flow state, no valid flow state found", 404, "flow_state_not_found"), "This sign-in has expired"],
    [new AuthApiError("code challenge does not match previously saved code verifier", 403, "bad_code_verifier"), "This sign-in has expired"],
    [new AuthRetryableFetchError("Failed to fetch", 0), "Couldn’t reach Sheltüh"],
    [new Error("boom"), "Something went wrong signing in"],
  ])("from the exchange (%s): shows %j, focused", async (err, title) => {
    const auth = signedOut({ completeOAuthSignIn: vi.fn().mockRejectedValue(err) });
    open("/auth/callback?code=abc&next=%2Faccount", auth);
    const heading = await screen.findByRole("heading", { level: 1, name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(auth.completeOAuthSignIn).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    // Never Supabase's own message.
    expect(document.body).not.toHaveTextContent(err.message);
  });

  it("never shows the URL's error_description, only our copy", async () => {
    const hostile = "Your account is locked. Call +61 400 000 000";
    open(
      `/auth/callback?error=access_denied&error_description=${encodeURIComponent(hostile)}#error=access_denied&error_description=${encodeURIComponent(hostile)}`,
      signedOut(),
    );
    await screen.findByRole("heading", { level: 1, name: "Sign-in cancelled" });
    expect(screen.getByText("Nothing has changed. Try again, or sign in with your email.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("locked");
    expect(document.body).not.toHaveTextContent("+61");
  });

  it("offers going back to sign in, or straight to its email form, carrying a safe next; no Try again", async () => {
    open("/auth/callback?next=%2Fevents%2Fneon-static%23whos-going&error=access_denied", signedOut());
    await screen.findByRole("heading", { level: 1, name: "Sign-in cancelled" });
    const next = encodeURIComponent("/events/neon-static#whos-going");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", `/login?next=${next}`);
    expect(screen.getByRole("link", { name: "Use email instead" })).toHaveAttribute("href", `/login?next=${next}#email`);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("drops an unsafe next from the way back", async () => {
    open("/auth/callback?next=%2F%2Fevil.example&error=access_denied", signedOut());
    await screen.findByRole("heading", { level: 1, name: "Sign-in cancelled" });
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Use email instead" })).toHaveAttribute("href", "/login#email");
  });

  it("a banned account is pointed to support, with only the way back to sign in", async () => {
    open("/auth/callback?error=access_denied&error_code=user_banned", signedOut());
    await screen.findByRole("heading", { level: 1, name: "This account can’t sign in" });
    expect(screen.getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Use email instead" })).toBeNull();
  });
});

describe("OAuthCallback: demo mode", () => {
  it("says accounts aren't configured, and exchanges nothing", async () => {
    const auth = signedOut({ configured: false });
    open("/auth/callback?code=abc", auth);
    const heading = await screen.findByRole("heading", { level: 1, name: "Accounts aren’t configured" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(auth.completeOAuthSignIn).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(screen.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Back to sign in" })).toBeNull();
  });
});
