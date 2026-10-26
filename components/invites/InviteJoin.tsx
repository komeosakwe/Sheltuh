"use client";

import { useState } from "react";
import LegalNote from "@/components/auth/LegalNote";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { acceptInvite } from "@/lib/api/invites";
import type { AcceptInviteResult, MyInvite } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  acceptErrorText,
  goneReason,
  inviteProblem,
  SUPPORT_LINK_LABEL,
  supportMailto,
  type InviteProblem,
} from "./invite-problems";

/** The accept error's id: the page's heading is described by it too, so it's read when the step opens with one. */
export const INVITE_JOIN_ERROR_ID = "invite-join-error";

/** The Join button's words: an organiser invite names its organiser. */
export function joinLabel(invite: MyInvite): string {
  return invite.kind === "organiser" ? `Join as ${invite.organiserName ?? "an organiser"}` : "Accept invite";
}

/** What went wrong, and whether the Sheltüh team can sort it out (an account that already has an organiser). */
interface JoinError {
  text: string;
  contact: boolean;
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
  /** Accepting already failed once (straight after creating the account): already in our words. */
  initialError?: string | null;
  onAccepted: (result: AcceptInviteResult) => void;
  onProblem: (problem: InviteProblem) => void;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JoinError | null>(initialError ? { text: initialError, contact: false } : null);
  const organiser = invite.kind === "organiser";

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onAccepted(await acceptInvite(invite.inviteId, auth.getAccessToken));
    } catch (err) {
      if (goneReason(err)) {
        onProblem({ ...inviteProblem(err, "accept the invite"), kind: invite.kind });
      } else if (err instanceof ApiError && err.status === 404) {
        onProblem({
          reason: "not-yours",
          title: "This invite isn’t for this account",
          message: "It was sent to another address. Sign out, then sign in with the address the invite was sent to.",
          retry: false,
          kind: invite.kind,
        });
      } else {
        // 409: the account already has an organiser profile; only the team can change that.
        setError({ text: acceptErrorText(err), contact: err instanceof ApiError && err.status === 409 });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <LegalNote
        lead={`By ${organiser ? "joining" : "accepting"}, you agree to our Terms of Use. Read them, and how we handle your details:`}
      />
      <div role="alert">
        {error && (
          <p id={INVITE_JOIN_ERROR_ID} className="text-sm text-danger">
            {error.text}
            {error.contact && (
              <>
                {" "}
                <a
                  href={supportMailto("Invite: my account already has an organiser")}
                  className="break-all text-foreground underline underline-offset-4"
                >
                  {SUPPORT_LINK_LABEL}
                </a>
              </>
            )}
          </p>
        )}
      </div>
      <Button
        variant="solid"
        size="lg"
        busy={busy}
        onClick={join}
        aria-describedby={error ? INVITE_JOIN_ERROR_ID : undefined}
        className="w-full sm:w-auto"
      >
        {busy ? (organiser ? "Joining…" : "Accepting…") : joinLabel(invite)}
      </Button>
      <p role="status" className="sr-only">
        {busy ? "Accepting your invite…" : ""}
      </p>
    </div>
  );
}
