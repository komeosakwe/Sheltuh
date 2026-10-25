"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { sameAccount, type AccountRef } from "@/lib/auth/account";
import { useAuth } from "@/lib/auth/AuthContext";
import { oauthProviderNames, offeredOAuthProviders } from "@/lib/auth/oauth";
import { isIosHomeScreenApp } from "@/lib/pwa/install";
import { withNext } from "@/lib/safe-next-path";

const FORM_ERROR_ID = "reauth-error";

/** The page the new-tab sign-in lands on afterwards: it says to come back here. */
const NEW_TAB_SIGN_IN_HREF = withNext("/login", "/signed-in");

/** Not yet known: the session at mount is still loading. */
const PENDING = Symbol("pending");

function differentAccountMessage(expected: AccountRef): string {
  return (
    `You're signed in as a different account than the one that started this draft. ` +
    `Sign in as ${expected.email ?? "that account"} to save it — signing in as anyone else won't be accepted.`
  );
}

/**
 * What a host form says (in its own polite live region) once a recovery has
 * signed in again, as it moves focus to its submit button: `action` is that
 * button's verb ("submit", "save").
 */
export function signedInAgainMessage(action: string): string {
  return `Signed in again. Your changes are still here — ${action} when you’re ready.`;
}

const noSubscription = () => () => {};

/** In the iOS home-screen app (hydration-safe: false on the server and while hydrating). */
function useIosHomeScreenApp(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => isIosHomeScreenApp(window),
    () => false,
  );
}

interface Props {
  /**
   * The account that was signed in when the draft being recovered was last
   * being edited, if known: captured by the host while signed in
   * (lib/auth/useAccountOwner.ts), never read from the live session here,
   * which by now may be gone or someone else's. When set, the email field is
   * locked to it and a sign-in as any *other* account is never accepted:
   * this is what stops one user's unsaved draft from being silently
   * submitted under a different account after an expired-session recovery.
   */
  expectedAccount?: AccountRef;
  onSignedIn: () => void;
}

/**
 * A sign-in control that never navigates away, so it can be dropped straight
 * into an expired-session message on top of a still-mounted form (event
 * editor, organiser application) — the fields above it are never lost.
 *
 * Deliberately NOT a nested <form>: both call sites render this inside their
 * own <form>, and a native `submit` event bubbles — a nested form's submit
 * button would also trigger the outer form's onSubmit (i.e. a save) via
 * React's delegated listener, double-submitting on every sign-in click.
 *
 * Like the sign-in page: empty fields are caught before Supabase is called,
 * focus goes to the first invalid field, and Sign in stays focusable while
 * it works (busy, not disabled).
 *
 * Accounts made with Google or Apple have no password, so (when those are
 * offered) a link opens /login in a new tab, which then lands on /signed-in
 * ("go back to your other tab"). Signing in there reaches this tab too
 * (Supabase shares sign-ins between tabs). Only once that link has been used
 * does a new sign-in (a new account, or a new sign-in time, which a token
 * refresh isn't expected to change) count: for the expected account it calls `onSignedIn`, once;
 * for another account it shows the different-account message and moves focus
 * to it, and signs nobody out (that session belongs to the other tab). A
 * password sign-in here decides for itself, and if it's the wrong account
 * signs out this browser only (`"local"`). Not in the iOS home-screen app:
 * its new tabs open in Safari, which has its own storage, so it says so.
 */
export default function InlineReauth({ expectedAccount, onSignedIn }: Props) {
  const auth = useAuth();
  const [email, setEmail] = useState(expectedAccount?.email ?? "");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AuthErrorField[]>([]);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const otherAccountRef = useRef<HTMLParagraphElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const providers = offeredOAuthProviders(auth.configured);
  const iosApp = useIosHomeScreenApp();
  const [waiting, setWaiting] = useState(false);
  const lockedEmail = expectedAccount?.email;

  const live: AccountRef | undefined =
    auth.status === "signed-in" ? { userId: auth.userId, email: auth.email } : undefined;
  // Signed in right now as someone other than the draft's owner: said for as long as it's true.
  const otherAccount = Boolean(expectedAccount && live && !sameAccount(live, expectedAccount));
  // Changes with each new sign-in (or account); not expected to with a token refresh (Supabase sets last_sign_in_at on sign-in).
  const signInKey =
    auth.status === "signed-in" ? [auth.userId ?? "", auth.email ?? "", auth.lastSignInAt ?? ""].join("\n") : undefined;
  const seenKey = useRef<string | undefined | typeof PENDING>(auth.status === "loading" ? PENDING : signInKey);
  // "Sign in in a new tab" has been used: only then does a sign-in from another tab count.
  const newTabUsed = useRef(false);
  // A password sign-in here is in flight (it decides for its own session).
  const passwordAttempt = useRef(false);
  // onSignedIn has been called (either way): a session arriving later doesn't call it again.
  const settled = useRef(false);

  useEffect(() => {
    if (auth.status === "loading") return;
    if (seenKey.current === PENDING) {
      seenKey.current = signInKey;
      return;
    }
    if (signInKey === seenKey.current) return;
    seenKey.current = signInKey;
    if (!signInKey || !newTabUsed.current || settled.current || passwordAttempt.current) return;

    if (otherAccount) {
      // Deferred so the effect body itself never calls setState. The message is already shown.
      queueMicrotask(() => {
        setWaiting(false);
        otherAccountRef.current?.focus();
      });
      return;
    }
    settled.current = true;
    queueMicrotask(() => setWaiting(false));
    onSignedIn();
  }, [auth.status, signInKey, otherAccount, onSignedIn]);

  async function handleSignIn() {
    if (loading) return;
    setError(null);
    setErrorFields([]);
    const missing = {
      email: email.trim() ? undefined : "Enter your email",
      password: password ? undefined : "Enter your password",
    };
    setFieldErrors(missing);
    if (missing.email || missing.password) {
      focusAfterRender(missing.email ? emailRef.current : passwordRef.current);
      return;
    }
    setLoading(true);
    passwordAttempt.current = true;
    try {
      await auth.signIn(email, password);
      if (expectedAccount && lockedEmail !== undefined && !sameAccount({ email }, { email: lockedEmail })) {
        // Signed in here, as the wrong account: this browser only, never the account's other devices.
        auth.signOut("local");
        setError(differentAccountMessage(expectedAccount));
        return;
      }
      settled.current = true;
      setWaiting(false);
      onSignedIn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't sign in.";
      const fields = fieldsForAuthError(message, ["email", "password"]);
      setError(message);
      setErrorFields(fields);
      // A locked email can't be fixed: the password is the field to go back to.
      const editable = fields.filter((field) => !(field === "email" && lockedEmail !== undefined));
      if (editable.includes("email")) focusAfterRender(emailRef.current);
      else if (editable.includes("password")) focusAfterRender(passwordRef.current);
    } finally {
      passwordAttempt.current = false;
      setLoading(false);
    }
  }

  /** The new-tab link was opened (a click, or a middle-click): from now on, a sign-in there counts. */
  function openedNewTab() {
    newTabUsed.current = true;
    setError(null);
    setWaiting(true);
  }

  function handlePasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleSignIn();
  }

  const invalidBy = (field: AuthErrorField) => (errorFields.includes(field) ? FORM_ERROR_ID : undefined);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-danger/20 pt-3">
      <AuthField
        ref={emailRef}
        id="reauth-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        readOnly={lockedEmail !== undefined}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        invalidBy={invalidBy("email")}
        compact
        className="read-only:opacity-70"
      />
      <AuthField
        ref={passwordRef}
        id="reauth-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={handlePasswordKeyDown}
        error={fieldErrors.password}
        invalidBy={invalidBy("password")}
        compact
      />
      {error && (
        <p id={FORM_ERROR_ID} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {otherAccount && !error && expectedAccount && (
        // Focused when it's the answer to the new-tab sign-in (so not an alert as well: it would be read twice).
        <p ref={otherAccountRef} tabIndex={-1} className="text-xs text-danger outline-offset-2">
          {differentAccountMessage(expectedAccount)}
        </p>
      )}
      <Button onClick={handleSignIn} busy={loading} className="w-fit">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      {providers.length > 0 &&
        (iosApp ? (
          <p className="text-xs leading-4 text-muted">
            Signed in with {oauthProviderNames(providers, ["google", "apple"])}? In the home-screen app, that sign-in
            can&rsquo;t reach this page. Copy anything you want to keep, then sign in again with Sign in, at the top of the
            page or in the menu.
          </p>
        ) : (
          // No gap: the live line is empty (but present, so it's announced) until the link is used.
          <div className="flex flex-col">
            <p className="text-xs leading-4 text-muted">
              Signed in with {oauthProviderNames(providers, ["google", "apple"])}?{" "}
              <Link
                href={NEW_TAB_SIGN_IN_HREF}
                target="_blank"
                rel="noopener"
                onClick={openedNewTab}
                onAuxClick={(event) => {
                  if (event.button === 1) openedNewTab();
                }}
                // Its menu may open the link in a new tab (or window): a sign-in there counts too.
                onContextMenu={() => {
                  newTabUsed.current = true;
                }}
                className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
              >
                Sign in in a new tab
              </Link>
            </p>
            <p aria-live="polite" className="text-xs text-muted">
              {waiting ? "Waiting for you to sign in in the other tab." : null}
            </p>
          </div>
        ))}
    </div>
  );
}
