"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";

export const navLinkClass =
  "px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:underline hover:decoration-2 hover:underline-offset-8";

/** `className` styles every link/button; it defaults to the desktop nav style (the phone menu passes its own). */
export default function AuthNavLinks({ className: linkClass = navLinkClass }: { className?: string } = {}) {
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
    return <span className="px-2 py-2 text-sm text-muted">…</span>;
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
      <Link href="/account" className={linkClass}>
        Account
      </Link>
      <button type="button" onClick={handleSignOut} className={linkClass}>
        Sign out
      </button>
    </>
  );
}
