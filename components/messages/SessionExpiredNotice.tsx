"use client";

import type { Ref } from "react";
import InlineReauth from "@/components/auth/InlineReauth";
import type { AccountRef } from "@/lib/auth/account";

/**
 * The session ran out while writing something: sign in again right here,
 * without leaving the page, so the draft above is kept (as the organiser
 * application does). Locked to the account that wrote it: `owner`, which the
 * host captured while signed in (lib/auth/useAccountOwner.ts), since by now
 * the live session is gone or may be someone else's. Takes focus when shown
 * (it isn't an alert as well, so it's read once).
 */
export default function SessionExpiredNotice({
  what,
  owner,
  onSignedIn,
  noticeRef,
}: {
  /** What's kept: "message", "report". */
  what: string;
  /** Who wrote it. */
  owner: AccountRef | undefined;
  onSignedIn: () => void;
  noticeRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={noticeRef} tabIndex={-1} className="border-l-2 border-danger py-1 pl-4 text-sm outline-offset-2">
      <p>Your session has expired. Sign in again to send your {what}: it&rsquo;s still here.</p>
      <InlineReauth expectedAccount={owner} onSignedIn={onSignedIn} />
    </div>
  );
}
