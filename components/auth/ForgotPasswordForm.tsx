"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { withNext } from "@/lib/safe-next-path";

const PASSWORD_HINT = "At least 8 characters, with an uppercase letter, a lowercase letter and a number.";
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const FORM_ERROR_ID = "reset-error";

type Field = "email" | "code" | "newPassword";

/**
 * `next` is the raw `?next=` return path, carried back to sign in.
 * Fields are checked here before Supabase is called; on any error, focus goes
 * to the first invalid field, which is marked and described by its error.
 */
export default function ForgotPasswordForm({ next }: { next?: string } = {}) {
  const auth = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
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
    return { email: emailRef, code: codeRef, newPassword: newPasswordRef }[field].current;
  }

  function reset() {
    setError(null);
    setErrorFields([]);
  }

  /** Shows field errors; true (and focus on the first) if there are any. */
  function invalid(errors: Partial<Record<Field, string>>, order: Field[]): boolean {
    setFieldErrors(errors);
    const first = order.find((field) => errors[field]);
    if (first) focusAfterRender(inputFor(first));
    return Boolean(first);
  }

  function showServerError(message: string, fallback: AuthErrorField[]) {
    // The service's "password" means the new one here.
    const fields = fieldsForAuthError(message, fallback).map((field): Field => (field === "password" ? "newPassword" : field));
    setError(message);
    setErrorFields(fields);
    const first = (["email", "code", "newPassword"] as const).find((field) => fields.includes(field));
    if (first) focusAfterRender(inputFor(first));
  }

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    reset();
    if (invalid({ email: email.trim() ? undefined : "Enter your email" }, ["email"])) return;
    setLoading(true);
    try {
      await auth.forgotPassword(email.trim());
      setFieldErrors({});
      setStep("confirm");
    } catch (err) {
      showServerError(err instanceof Error ? err.message : "Couldn't send a reset code.", ["email"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    reset();
    const errors: Partial<Record<Field, string>> = {};
    if (!code.trim()) errors.code = "Enter the reset code";
    if (!newPassword) errors.newPassword = "Enter your new password";
    else if (!PASSWORD_REGEX.test(newPassword)) errors.newPassword = "Password doesn't meet the requirements.";
    if (invalid(errors, ["code", "newPassword"])) return;
    setLoading(true);
    try {
      await auth.confirmForgotPassword(email.trim(), code.trim(), newPassword);
      router.push(withNext("/login", next));
    } catch (err) {
      showServerError(err instanceof Error ? err.message : "Couldn't reset your password.", ["code"]);
    } finally {
      setLoading(false);
    }
  }

  const invalidBy = (field: Field) => (errorFields.includes(field) ? FORM_ERROR_ID : undefined);
  const formError = error && (
    <p id={FORM_ERROR_ID} role="alert" className="text-sm text-danger">
      {error}
    </p>
  );

  if (step === "request") {
    return (
      <form onSubmit={handleRequestCode} className="flex flex-col gap-5" noValidate>
        <p className="text-sm text-muted">Enter your account email and we&rsquo;ll send a reset code.</p>
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
        {formError}
        <Button type="submit" size="lg" busy={loading} className="w-full">
          {loading ? "Sending…" : "Send reset code"}
        </Button>
        <p className="text-sm text-muted">
          <Link href={withNext("/login", next)} className="text-accent underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleConfirm} className="flex flex-col gap-5" noValidate>
      <p className="text-sm text-muted">Enter the code we sent to {email} and choose a new password.</p>
      <AuthField
        ref={codeRef}
        id="code"
        label="Reset code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={fieldErrors.code}
        invalidBy={invalidBy("code")}
      />
      <AuthField
        ref={newPasswordRef}
        id="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={fieldErrors.newPassword}
        invalidBy={invalidBy("newPassword")}
        hint={PASSWORD_HINT}
      />
      {formError}
      <Button type="submit" size="lg" busy={loading} className="w-full">
        {loading ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
