"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";

const FORM_ERROR_ID = "reauth-error";

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
    try {
      await auth.signIn(email, password);
      if (expectedEmail && email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
        auth.signOut();
        setError(
          `You're signed in as a different account than the one that started this draft. ` +
            `Sign in as ${expectedEmail} to save it — signing in as anyone else won't be accepted.`,
        );
        return;
      }
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
    </div>
  );
}
