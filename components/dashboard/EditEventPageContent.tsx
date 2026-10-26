"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import EventEditor from "@/components/dashboard/EventEditor";
import { seatMapHref, seatMapLinkLabel } from "@/components/dashboard/SeatingChoice";
import { ButtonLink } from "@/components/ui/Button";
import type { GetToken } from "@/lib/api/client";
import { getMyEvent } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { useAuth } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";

export default function EditEventPageContent() {
  const auth = useAuth();
  const params = useParams<{ eventId: string }>();
  const { loading: organiserLoading, organiser } = useOrganiser();
  const account = accountKey(auth);
  // The event (or why it couldn't be loaded), and the account it was loaded for.
  const [loaded, setLoaded] = useState<{ account: string; event: EventRecord | null; error: string | null } | null>(null);

  const ready = auth.status === "signed-in" && organiser?.status === "approved";
  const getToken = auth.getAccessToken;
  // Signed in, with this account's organiser status loaded.
  const settled = auth.status === "signed-in" && !organiserLoading;
  // This account's own event; until another account has settled, the last one's (for the kept editor).
  const current = loaded && (loaded.account === account || !settled) ? loaded : null;
  const event = current?.event ?? null;
  const error = current?.error ?? null;
  // The editor was on screen: kept while the session has run out (or another
  // account's status is loading), so it stays mounted with the unsaved
  // changes and its own recovery can sign in again in place. Not after the
  // person's own Sign out; keyed by account, so another account never gets it.
  const editor = useKeptWhileSignedOut(ready && event !== null && !error, settled);

  useEffect(() => {
    if (!ready || account === null) return;
    let cancelled = false;
    getMyEvent(params.eventId, getToken)
      .then((record) => {
        if (!cancelled) setLoaded({ account, event: record, error: null });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ account, event: null, error: err instanceof Error ? err.message : "Couldn't load this event." });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, account, getToken, params.eventId]);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (event && editor?.value) {
    const as = editor.account;
    return (
      <EditorView
        key={as}
        event={event}
        getToken={getToken}
        payoutsEnabled={organiser ? organiser.payoutsEnabled === true : undefined}
        onSaved={(record) => setLoaded({ account: as, event: record, error: null })}
      />
    );
  }

  if (auth.status === "loading" || organiserLoading) {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status !== "signed-in" || !organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3 text-foreground">You need an approved organiser application to manage events.</p>
        <Link href="/organisers/apply" className="btn btn-solid">
          Apply as an organiser
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }

  return <LoadingState text="Loading event…" />;
}

/** The editor and its links. One component wherever it's shown from, so it's never remounted (losing edits). */
function EditorView({
  event,
  getToken,
  payoutsEnabled,
  onSaved,
}: {
  event: EventRecord;
  getToken: GetToken;
  /** The organiser's, once known (the editor says when paid tickets need payouts before submitting). */
  payoutsEnabled: boolean | undefined;
  onSaved: (record: EventRecord) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <ButtonLink
          variant="outline"
          size="sm"
          className="min-h-11 w-fit"
          href={`/dashboard/events/${encodeURIComponent(event.eventId)}/analytics`}
        >
          Analytics
        </ButtonLink>
        {/* Reserved seating: optional, for Sheltüh-ticketed events (docs/design/seating.md §5.13); also in the editor's Seating section. */}
        {event.ticketingMode !== "external" && (
          <ButtonLink
            variant="outline"
            size="sm"
            className="min-h-11 w-fit"
            href={seatMapHref(event.eventId, false)}
          >
            {seatMapLinkLabel(event.seating)}
          </ButtonLink>
        )}
      </div>
      <EventEditor getToken={getToken} initial={event} payoutsEnabled={payoutsEnabled} onSaved={onSaved} />
    </>
  );
}
