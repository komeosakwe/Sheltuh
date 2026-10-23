"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { LoadingState } from "@/components/ui/ProgressLoader";

export default function AdminGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading") {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status === "signed-out") {
    return (
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3 text-foreground">Sign in with an admin account to continue.</p>
        <Link href="/login" className="btn btn-solid">
          Sign in
        </Link>
      </div>
    );
  }

  if (!auth.isAdmin) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Your account doesn&rsquo;t have admin access.
      </p>
    );
  }

  return <>{children}</>;
}
