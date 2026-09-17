"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";

const PASSWORD_HINT = "At least 8 characters, with an uppercase letter, a lowercase letter and a number.";
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default function ForgotPasswordForm() {
  const auth = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await auth.forgotPassword(email);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a reset code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!PASSWORD_REGEX.test(newPassword)) {
      setError(`Password doesn't meet the requirements. ${PASSWORD_HINT}`);
      return;
    }
    setLoading(true);
    try {
      await auth.confirmForgotPassword(email, code, newPassword);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset your password.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "request") {
    return (
      <form onSubmit={handleRequestCode} className="flex flex-col gap-5" noValidate>
        <p className="text-sm text-muted">Enter your account email and we&rsquo;ll send a reset code.</p>
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
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send reset code"}
        </button>
        <p className="text-sm text-muted">
          <Link href="/login" className="text-accent underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleConfirm} className="flex flex-col gap-5" noValidate>
      <p className="text-sm text-muted">Enter the code we sent to {email} and choose a new password.</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium text-foreground">
          Reset code
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
      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm font-medium text-foreground">
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-describedby="password-hint"
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        <p id="password-hint" className="text-xs text-muted">
          {PASSWORD_HINT}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
