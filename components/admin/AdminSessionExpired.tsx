"use client";

import { createContext, useContext, type ReactNode } from "react";
import InlineReauth from "@/components/auth/InlineReauth";
import type { AccountRef } from "@/lib/auth/account";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";

export const ADMIN_SESSION_EXPIRED = "Your session has expired.";

const AdminOwnerContext = createContext<AccountRef | undefined>(undefined);

/**
 * The admin who's using these pages, captured while they're signed in
 * (AdminShell renders this around every admin page, keyed by account, so
 * another admin signing in remounts it and everything in it), so a sign-in
 * form shown after their session has gone is locked to them rather than to
 * whoever the live session belongs to by then.
 */
export function AdminOwnerProvider({ children }: { children: ReactNode }) {
  const { owner } = useAccountOwner();
  return <AdminOwnerContext.Provider value={owner}>{children}</AdminOwnerContext.Provider>;
}

/**
 * The session ran out mid-action: sign in again right here, without leaving
 * the page, so whatever's typed (a reason) is kept; then the admin tries the
 * action again. Locked to the admin these pages were opened by
 * (AdminOwnerProvider) when it's known.
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
  const owner = useContext(AdminOwnerContext);
  return (
    <div className="border-l-2 border-danger py-1 pl-4 text-sm text-foreground">
      <p role={alert ? "alert" : undefined}>
        {ADMIN_SESSION_EXPIRED} Sign in again{withForm ? " below" : ""}, then {then}.
      </p>
      {withForm && <InlineReauth expectedAccount={owner} onSignedIn={onSignedIn} />}
    </div>
  );
}
