"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { oauthProviderNames, offeredOAuthProviders } from "@/lib/auth/oauth";

const FORM_ERROR_ID = "reauth-error";

/** Not yet known: the session at mount is still loading. */
const PENDING = Symbol("pending");

function sameEmail(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function differentAccountMessage(expectedEmail: string): string {
  return (
    `You're signed in as a different account than the one that started this draft. ` +
    `Sign in as ${expectedEmail} to save it — signing in as anyone else won't be accepted.`
  );
}

interface Props {
  /**
   * The account that was signed in when the draft being recovered was last
   * being edited, if known. When set, the email field is locked to it and a
   * successful sign-in as any *other* account is rejected — this is what
   * stops one user's unsaved draft from being silently submitted under a
   * different account after an expired-session recovery.
   */
  expectedEmail?: string;
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
 * offered) a link opens /login in a new tab. Signing in there reaches this
 * tab too (Supabase shares sign-ins between tabs), and a new session for the
 * expected account calls `onSignedIn`, once; another account's is refused
 * and signed out, as here. The session this mounted with never counts, and
 * neither does the one a password sign-in here brings (that path calls
 * `onSignedIn` itself). Not in the iOS home-screen app: its new tabs open in
 * Safari, which has its own storage.
 */
export default function InlineReauth({ expectedEmail, onSignedIn }: Props) {
  const auth = useAuth();
  const [email, setEmail] = useState(expectedEmail ?? "");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AuthErrorField[]>([]);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const providers = offeredOAuthProviders(auth.configured);
  const [waiting, setWaiting] = useState(false);

  // The access token last seen: one that differs is a new session.
  const sessionToken = auth.status === "signed-in" ? auth.accessToken : undefined;
  const seenToken = useRef<string | undefined | typeof PENDING>(auth.status === "loading" ? PENDING : sessionToken);
  // A password sign-in here is in flight (it decides for its own session).
  const passwordAttempt = useRef(false);
  // onSignedIn has been called (either way): a session arriving later doesn't call it again.
  const settled = useRef(false);
  const { email: sessionEmail, signOut } = auth;

  useEffect(() => {
    if (auth.status === "loading") return;
    if (seenToken.current === PENDING) {
      seenToken.current = sessionToken;
      return;
    }
    if (sessionToken === seenToken.current) return;
    seenToken.current = sessionToken;
    if (!sessionToken || settled.current || passwordAttempt.current) return;

    if (expectedEmail && !sameEmail(sessionEmail, expectedEmail)) {
      signOut();
      // Deferred so the effect body itself never calls setState.
      queueMicrotask(() => {
        setWaiting(false);
        setError(differentAccountMessage(expectedEmail));
      });
      return;
    }
    settled.current = true;
    queueMicrotask(() => setWaiting(false));
    onSignedIn();
  }, [auth.status, sessionToken, sessionEmail, expectedEmail, signOut, onSignedIn]);

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
      if (expectedEmail && !sameEmail(email, expectedEmail)) {
        auth.signOut();
        setError(differentAccountMessage(expectedEmail));
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
      const editable = fields.filter((field) => !(field === "email" && expectedEmail));
      if (editable.includes("email")) focusAfterRender(emailRef.current);
      else if (editable.includes("password")) focusAfterRender(passwordRef.current);
    } finally {
      passwordAttempt.current = false;
      setLoading(false);
    }
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
        readOnly={Boolean(expectedEmail)}
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
      <Button onClick={handleSignIn} busy={loading} className="w-fit">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      {providers.length > 0 && (
        // No gap: the live line is empty (but present, so it's announced) until the link is used.
        <div className="flex flex-col">
          <p className="text-xs leading-4 text-muted">
            Signed in with {oauthProviderNames(providers, ["google", "apple"])}?{" "}
            <Link
              href="/login"
              target="_blank"
              rel="noopener"
              onClick={() => {
                setError(null);
                setWaiting(true);
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
      )}
    </div>
  );
}
