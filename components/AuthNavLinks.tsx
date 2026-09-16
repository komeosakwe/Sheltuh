"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";

const linkClass =
  "rounded px-3 py-2 font-medium text-foreground transition-colors hover:bg-surface hover:text-accent";

export default function AuthNavLinks() {
  const auth = useAuth();
  const router = useRouter();

  if (!auth.configured) {
    return (
      <Link href="/login" className={linkClass} title="Accounts aren't configured in this environment yet">
        Sign in
      </Link>
    );
  }

  if (auth.status === "loading") {
    return <span className="px-3 py-2 text-sm text-muted">…</span>;
  }

  if (auth.status === "signed-out") {
    return (
      <Link href="/login" className={linkClass}>
        Sign in
      </Link>
    );
  }

  function handleSignOut() {
    auth.signOut();
    router.push("/");
  }

  return (
    <>
      {auth.isAdmin && (
        <Link href="/admin" className={linkClass}>
          Admin
        </Link>
      )}
      <Link href="/dashboard" className={linkClass}>
        My events
      </Link>
      <button type="button" onClick={handleSignOut} className={linkClass}>
        Sign out
      </button>
    </>
  );
}
