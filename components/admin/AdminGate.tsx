"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthContext";

export default function AdminGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading") {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (auth.status === "signed-out") {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="mb-3 text-foreground">Sign in with an admin account to continue.</p>
        <Link href="/login" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Sign in
        </Link>
      </div>
    );
  }

  if (!auth.isAdmin) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Your account doesn&rsquo;t have admin access.
      </p>
    );
  }

  return <>{children}</>;
}
