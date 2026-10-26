"use client";

import { Suspense, useState } from "react";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { useAuth } from "@/lib/auth/AuthContext";
import InviteForm from "./InviteForm";
import InviteQueue, { INVITES_HEADING_ID, isQueueReauthOwner } from "./InviteQueue";

/**
 * /admin/invites (docs/architecture.md, "Account invites"): the form to
 * invite someone, then the invites by status. A new invite reloads the list.
 * After an expired session, one sign-in form is shown (InlineReauth's fields
 * have fixed ids): `reauthOwner` says whose, the form's ("form") or the
 * list's (InviteQueue's owners); the others say so in words only.
 */
export default function InvitesAdmin() {
  const auth = useAuth();
  const [created, setCreated] = useState(0);
  const [reauthOwner, setReauthOwner] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="invite-form-heading" className="flex flex-col gap-4 border-t border-foreground pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="invite-form-heading" className="display-md !text-2xl">
            Invite someone
          </h2>
          {/* On a phone the list is a long scroll below the form. */}
          <a
            href={`#${INVITES_HEADING_ID}`}
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 sm:hidden"
          >
            Jump to invites
          </a>
        </div>
        <InviteForm
          getToken={auth.getAccessToken}
          onCreated={() => {
            setCreated((n) => n + 1);
            // The list reloads: whatever it had going (a sign-in included) no longer applies.
            setReauthOwner((owner) => (isQueueReauthOwner(owner) ? null : owner));
          }}
          reauthOwner={reauthOwner}
          onClaimReauth={setReauthOwner}
        />
      </section>
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <InviteQueue
          getToken={auth.getAccessToken}
          refreshKey={created}
          reauthOwner={reauthOwner}
          onClaimReauth={setReauthOwner}
        />
      </Suspense>
    </div>
  );
}
