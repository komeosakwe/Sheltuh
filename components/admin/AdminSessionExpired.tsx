"use client";

import InlineReauth from "@/components/auth/InlineReauth";
import { useAuth } from "@/lib/auth/AuthContext";

export const ADMIN_SESSION_EXPIRED = "Your session has expired.";

/**
 * The session ran out mid-action: sign in again right here, without leaving
 * the page, so whatever's typed (a reason) is kept; then the admin tries the
 * action again. Locked to the signed-in account when it's known.
 *
 * InlineReauth's fields have fixed ids, so only one of these may be shown at
 * a time (the queue decides which); `withForm={false}` shows the words only.
 */
export default function AdminSessionExpired({
  then,
  withForm = true,
  alert = true,
  onSignedIn,
}: {
  /** What to do once signed in: "suspend them", "approve this application". */
  then: string;
  withForm?: boolean;
  /** false when focus is moved onto it instead (so it isn't read twice). */
  alert?: boolean;
  onSignedIn: () => void;
}) {
  const auth = useAuth();
  return (
    <div className="border-l-2 border-danger py-1 pl-4 text-sm text-foreground">
      <p role={alert ? "alert" : undefined}>
        {ADMIN_SESSION_EXPIRED} Sign in again{withForm ? " below" : ""}, then {then}.
      </p>
      {withForm && <InlineReauth expectedEmail={auth.email} onSignedIn={onSignedIn} />}
    </div>
  );
}
