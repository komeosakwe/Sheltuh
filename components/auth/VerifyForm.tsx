"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender, type AuthErrorField } from "@/components/auth/AuthField";
import HumanCheckField from "@/components/auth/HumanCheckField";
import { Button } from "@/components/ui/Button";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth/AuthContext";
import { HUMAN_CHECK_CANCELLED, useHumanCheck } from "@/lib/auth/useHumanCheck";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath, withNext } from "@/lib/safe-next-path";

const FORM_ERROR_ID = "verify-error";

/**
 * Fields are checked here before Supabase is called; on any error, focus goes
 * to the first invalid field, which is marked and described by its error.
 * "Resend code" stays focusable while it sends (busy, not disabled), and asks
 * for the email if it's empty rather than being disabled without saying why.
 *
 * The `?email=` sign-up and sign-in send here with is read once, into the
 * field, and taken out of the address bar (history.replaceState, which Next
 * syncs with useSearchParams), so the address isn't left in the URL, history
 * or a copied link. `next` stays.
 *
 * Cloudflare Turnstile (lib/auth/useHumanCheck.ts) guards only "Resend code",
 * so its widget (and Cloudflare's script) is added only once that's pressed.
 */
export default function VerifyForm() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  // Where to go once verified (and signed in): a safe ?next= path, or the dashboard.
  const next = searchParams.get("next") ?? undefined;
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; code?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AuthErrorField[]>([]);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  // For "Resend code" only: confirming the code (verifyOtp) isn't guarded.
  const humanCheck = useHumanCheck("resend-code");
  // The widget is rendered (and Cloudflare's script loaded) from the first "Resend code" on.
  const [checkShown, setCheckShown] = useState(false);

  // Once read into the field, the email leaves the address bar.
  const emailInUrl = searchParams.has("email");
  useEffect(() => {
    if (!emailInUrl) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [emailInUrl]);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  function showServerError(message: string, fallback: AuthErrorField[]) {
    const fields = fieldsForAuthError(message, fallback);
    setError(message);
    setErrorFields(fields);
    if (fields.includes("email")) focusAfterRender(emailRef.current);
    else if (fields.includes("code")) focusAfterRender(codeRef.current);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setErrorFields([]);
    setResendMessage(null);
    const missing = {
      email: email.trim() ? undefined : "Enter your email",
      code: code.trim() ? undefined : "Enter the verification code",
    };
    setFieldErrors(missing);
    if (missing.email || missing.code) {
      focusAfterRender(missing.email ? emailRef.current : codeRef.current);
      return;
    }
    setLoading(true);
    try {
      // Confirming also signs the new account in.
      await auth.confirmSignUp(email.trim(), code.trim());
      track("sign_up_completed", { signup_method: "email" });
      router.push(safeNextPath(next) ?? DEFAULT_AFTER_SIGN_IN);
    } catch (err) {
      showServerError(err instanceof Error ? err.message : "Couldn't verify that code.", ["code"]);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resending) return;
    setError(null);
    setErrorFields([]);
    setResendMessage(null);
    if (!email.trim()) {
      setFieldErrors({ email: "Enter your email" });
      focusAfterRender(emailRef.current);
      return;
    }
    setFieldErrors({});
    setResending(true);
    setCheckShown(true);
    // The address the code goes to: an edit made while the check runs mustn't change it.
    const address = email.trim();
    try {
      const token = await humanCheck.getToken();
      // The form went while it waited: send nothing.
      if (token === HUMAN_CHECK_CANCELLED) return;
      await auth.resendConfirmationCode(address, token);
      // Verify email then confirms with the address the new code went to.
      setEmail(address);
      setResendMessage("New code sent.");
    } catch (err) {
      showServerError(err instanceof Error ? err.message : "Couldn't resend the code.", ["email"]);
    } finally {
      // The token is used up either way.
      humanCheck.reset();
      setResending(false);
    }
  }

  const invalidBy = (field: AuthErrorField) => (errorFields.includes(field) ? FORM_ERROR_ID : undefined);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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
      <AuthField
        ref={codeRef}
        id="code"
        label="Verification code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        name="code"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={fieldErrors.code}
        invalidBy={invalidBy("code")}
      />

      {error && (
        <p id={FORM_ERROR_ID} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {/* Always mounted, so the message is announced when it arrives. */}
      <p role="status" className="text-sm text-accent empty:hidden">
        {resendMessage}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" busy={loading} className="w-full">
          {loading ? "Verifying…" : "Verify email"}
        </Button>
        <button
          type="button"
          onClick={handleResend}
          aria-disabled={resending ? true : undefined}
          className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      </div>
      {checkShown && <HumanCheckField check={humanCheck} />}

      <p className="text-sm text-muted">
        <Link href={withNext("/login", next)} className="text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
