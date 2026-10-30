"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import PasswordField from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { oauthProviderNames, offeredOAuthProviders } from "@/lib/auth/oauth";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath, withNext } from "@/lib/safe-next-path";

const FORM_ERROR_ID = "login-error";

/** Supabase Auth's message for a wrong email or password (it won't say which). */
const INVALID_CREDENTIALS = "invalid login credentials";

function noPasswordHint(names: string): string {
  return `Signed up with ${names}? Use the ${names} button above.`;
}

/**
 * `next` is the raw `?next=` value: where to go after signing in. Only a
 * same-site relative path is honoured; anything else goes to the dashboard.
 *
 * Empty fields are caught here, before Supabase is called; on any error,
 * focus goes to the first invalid field, which is marked and described by
 * its error. A wrong email or password marks both (the service won't say which).
 *
 * With Apple or Google offered above the form (OAuthButtons), the password
 * field's hint says an account made with one of them has no password, and a
 * wrong email or password says to use that button (such an account has no
 * password to get right).
 */
export default function LoginForm({ next }: { next?: string } = {}) {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AuthErrorField[]>([]);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const providers = offeredOAuthProviders(auth.configured);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      await auth.signIn(email.trim(), password);
      router.push(safeNextPath(next) ?? DEFAULT_AFTER_SIGN_IN);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't sign in.";
      const fields = fieldsForAuthError(message, ["email", "password"]);
      const wrongCredentials = providers.length > 0 && message.trim().toLowerCase() === INVALID_CREDENTIALS;
      setError(
        wrongCredentials
          ? `That email and password don’t match. If you signed up with ${oauthProviderNames(providers, ["apple", "google"])}, use that button above.`
          : message,
      );
      setErrorFields(fields);
      if (fields.includes("email")) focusAfterRender(emailRef.current);
      else if (fields.includes("password")) focusAfterRender(passwordRef.current);
    } finally {
      setLoading(false);
    }
  }

  const invalidBy = (field: AuthErrorField) => (errorFields.includes(field) ? FORM_ERROR_ID : undefined);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <AuthField
        ref={emailRef}
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        name="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        invalidBy={invalidBy("email")}
      />
      <PasswordField
        ref={passwordRef}
        id="password"
        label="Password"
        autoComplete="current-password"
        name="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        invalidBy={invalidBy("password")}
        hint={providers.length > 0 ? noPasswordHint(oauthProviderNames(providers, ["google", "apple"])) : undefined}
        labelAside={
          <Link
            href={withNext("/forgot-password", next)}
            className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-2"
          >
            Forgot password?
          </Link>
        }
      />

      {error && (
        <p id={FORM_ERROR_ID} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {error && /not confirmed/i.test(error) && (
        <Link
          href={withNext("/verify", next, email.trim() ? { email: email.trim() } : {})}
          className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-2"
        >
          Verify your email
        </Link>
      )}

      <Button type="submit" size="lg" busy={loading} className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-sm text-muted">
        No account yet?{" "}
        <Link href={withNext("/signup", next)} className="text-accent underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </form>
  );
}
