"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";

export default function VerifyForm() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Confirming also signs the new account in.
      await auth.confirmSignUp(email, code);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify that code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResendMessage(null);
    setResending(true);
    try {
      await auth.resendConfirmationCode(email);
      setResendMessage("A new code is on its way — check your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resend the code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium text-foreground">
          Verification code
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {resendMessage && (
        <p role="status" className="text-sm text-accent">
          {resendMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Verifying…" : "Verify email"}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || !email}
          className="text-sm text-accent underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      </div>

      <p className="text-sm text-muted">
        <Link href="/login" className="text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
