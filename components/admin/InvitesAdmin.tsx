"use client";

import { Suspense, useState } from "react";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { useAuth } from "@/lib/auth/AuthContext";
import InviteForm from "./InviteForm";
import InviteQueue from "./InviteQueue";

/**
 * /admin/invites (docs/architecture.md, "Account invites"): the form to
 * invite someone, then the invites by status. A new invite reloads the list.
 */
export default function InvitesAdmin() {
  const auth = useAuth();
  const [created, setCreated] = useState(0);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="invite-form-heading" className="flex flex-col gap-4 border-t border-foreground pt-5">
        <h2 id="invite-form-heading" className="display-md !text-2xl">
          Invite someone
        </h2>
        <InviteForm getToken={auth.getAccessToken} onCreated={() => setCreated((n) => n + 1)} />
      </section>
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <InviteQueue getToken={auth.getAccessToken} refreshKey={created} />
      </Suspense>
    </div>
  );
}
