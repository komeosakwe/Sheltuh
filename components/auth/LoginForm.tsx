"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { safeNextPath } from "@/lib/safe-next-path";

/**
 * `next` is the raw `?next=` value: where to go after signing in. Only a
 * same-site relative path is honoured; anything else goes to the dashboard.
 */
export default function LoginForm({ next }: { next?: string } = {}) {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await auth.signIn(email, password);
      router.push(safeNextPath(next) ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setLoading(false);
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
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-accent underline underline-offset-2">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
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
        className="btn btn-solid w-fit"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-sm text-muted">
        No account yet?{" "}
        <Link href="/signup" className="text-accent underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </form>
  );
}
