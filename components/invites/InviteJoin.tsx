"use client";

import { useState } from "react";
import LegalNote from "@/components/auth/LegalNote";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { acceptInvite } from "@/lib/api/invites";
import type { AcceptInviteResult, MyInvite } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { goneReason, inviteProblem, type InviteProblem } from "./invite-problems";

const ERROR_ID = "invite-join-error";

/** The Join button's words: an organiser invite names its organiser. */
export function joinLabel(invite: MyInvite): string {
  return invite.kind === "organiser" ? `Join as ${invite.organiserName ?? "an organiser"}` : "Accept invite";
}

/**
 * The last step, signed in with the invite's address: what accepting does,
 * the Terms and Privacy links, and the button (POST /api/invites/accept).
 * A refusal that ends the invite (withdrawn, expired, used, not this
 * account's) goes back to the page; anything else is said here and can be
 * tried again.
 */
export default function InviteJoin({
  invite,
  initialError,
  onAccepted,
  onProblem,
}: {
  invite: MyInvite;
  /** Accepting already failed once (straight after creating the account). */
  initialError?: string | null;
  onAccepted: (result: AcceptInviteResult) => void;
  onProblem: (problem: InviteProblem) => void;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onAccepted(await acceptInvite(invite.inviteId, auth.getAccessToken));
    } catch (err) {
      if (goneReason(err)) {
        onProblem(inviteProblem(err, "accept the invite"));
      } else if (err instanceof ApiError && err.status === 404) {
        onProblem({
          reason: "not-yours",
          title: "This invite isn’t for this account",
          message: "It was sent to another address. Sign out, then sign in with the address the invite was sent to.",
          retry: false,
        });
      } else {
        setError(err instanceof Error && err.message ? err.message : "Couldn’t accept the invite. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <LegalNote lead="By joining, you agree to our Terms of Use. Read them, and how we handle your details:" />
      <div role="alert">
        {error && (
          <p id={ERROR_ID} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="solid"
        size="lg"
        busy={busy}
        onClick={join}
        aria-describedby={error ? ERROR_ID : undefined}
        className="w-full sm:w-auto"
      >
        {busy ? "Joining…" : joinLabel(invite)}
      </Button>
      <p role="status" className="sr-only">
        {busy ? "Accepting your invite…" : ""}
      </p>
    </div>
  );
}
