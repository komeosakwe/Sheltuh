"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import LegalNote from "@/components/auth/LegalNote";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { PASSWORD_HINT, PASSWORD_REGEX } from "@/lib/auth/password-rules";
import { withNext } from "@/lib/safe-next-path";

const FORM_ERROR_ID = "signup-error";

type Field = "email" | "password" | "confirmPassword";

/**
 * `next` is the raw `?next=` return path, carried on to /verify (and back to sign in).
 * Fields are checked here before Supabase is called; on any error, focus goes
 * to the first invalid field, which is marked and described by its error.
 * The privacy line sits above the button, so it's read before signing up.
 */
export default function SignupForm({ next }: { next?: string } = {}) {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AuthErrorField[]>([]);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  /** The field's input, for moving focus to it (handlers only). */
  function inputFor(field: Field): HTMLInputElement | null {
    return { email: emailRef, password: passwordRef, confirmPassword: confirmPasswordRef }[field].current;
  }

  function validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!email.trim()) errors.email = "Enter your email";
    if (!password) errors.password = "Enter your password";
    else if (!PASSWORD_REGEX.test(password)) errors.password = "Password doesn't meet the requirements.";
    if (!confirmPassword) errors.confirmPassword = "Confirm your password";
    else if (password && password !== confirmPassword) errors.confirmPassword = "Passwords don't match.";
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setErrorFields([]);
    const errors = validate();
    setFieldErrors(errors);
    const firstInvalid = (["email", "password", "confirmPassword"] as const).find((field) => errors[field]);
    if (firstInvalid) {
      focusAfterRender(inputFor(firstInvalid));
      return;
    }

    setLoading(true);
    try {
      await auth.signUp(email.trim(), password);
      router.push(withNext("/verify", next, { email: email.trim() }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't sign up.";
      const fields = fieldsForAuthError(message, ["email"]);
      setError(message);
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
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        invalidBy={invalidBy("email")}
      />
      <AuthField
        ref={passwordRef}
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        invalidBy={invalidBy("password")}
        hint={PASSWORD_HINT}
      />
      <AuthField
        ref={confirmPasswordRef}
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        error={fieldErrors.confirmPassword}
      />

      {error && (
        <p id={FORM_ERROR_ID} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <LegalNote />

      <Button type="submit" size="lg" busy={loading} className="w-full">
        {loading ? "Creating account…" : "Sign up"}
      </Button>

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href={withNext("/login", next)} className="text-accent underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
