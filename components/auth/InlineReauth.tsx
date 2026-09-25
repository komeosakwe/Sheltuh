"use client";

import { useState, type KeyboardEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";

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
 */
export default function InlineReauth({ expectedEmail, onSignedIn }: Props) {
  const auth = useAuth();
  const [email, setEmail] = useState(expectedEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
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
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setLoading(false);
    }
  }

  function handlePasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!loading) void handleSignIn();
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-danger/20 pt-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="reauth-email" className="text-xs font-medium text-foreground">
          Email
        </label>
        <input
          id="reauth-email"
          type="email"
          autoComplete="email"
          required
          readOnly={Boolean(expectedEmail)}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-1.5 text-sm text-foreground read-only:opacity-70"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reauth-password" className="text-xs font-medium text-foreground">
          Password
        </label>
        <input
          id="reauth-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handlePasswordKeyDown}
          className="rounded border border-surface-border bg-background px-3 py-1.5 text-sm text-foreground"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleSignIn}
        disabled={loading}
        className="w-fit rounded bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}
