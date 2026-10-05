"use client";

import type { Ref } from "react";
import InlineReauth from "@/components/auth/InlineReauth";
import { useAuth } from "@/lib/auth/AuthContext";

/**
 * The session ran out while writing something: sign in again right here,
 * without leaving the page, so the draft above is kept (as the organiser
 * application does). Locked to the account that wrote it. Takes focus when
 * shown (it isn't an alert as well, so it's read once).
 */
export default function SessionExpiredNotice({
  what,
  onSignedIn,
  noticeRef,
}: {
  /** What's kept: "message", "report". */
  what: string;
  onSignedIn: () => void;
  noticeRef?: Ref<HTMLDivElement>;
}) {
  const auth = useAuth();
  return (
    <div ref={noticeRef} tabIndex={-1} className="border-l-2 border-danger py-1 pl-4 text-sm outline-offset-2">
      <p>Your session has expired. Sign in again to send your {what}: it&rsquo;s still here.</p>
      <InlineReauth expectedEmail={auth.email} onSignedIn={onSignedIn} />
    </div>
  );
}
