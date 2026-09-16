"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import EventEditor from "@/components/dashboard/EventEditor";
import { getMyEvent } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

export default function EditEventPageContent() {
  const auth = useAuth();
  const params = useParams<{ eventId: string }>();
  const { loading: organiserLoading, organiser } = useOrganiser();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = auth.status === "signed-in" && Boolean(auth.idToken) && organiser?.status === "approved";

  useEffect(() => {
    if (!ready || !auth.idToken) return;
    let cancelled = false;
    getMyEvent(params.eventId, auth.idToken)
      .then((record) => {
        if (!cancelled) setEvent(record);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this event.");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, auth.idToken, params.eventId]);

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || organiserLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (auth.status !== "signed-in" || !organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="mb-3 text-foreground">You need an approved organiser application to manage events.</p>
        <Link href="/organisers/apply" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
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

  if (!event) {
    return <p className="text-sm text-muted">Loading event…</p>;
  }

  return (
    <EventEditor
      idToken={auth.idToken as string}
      organiserId={organiser.organiserId}
      initial={event}
      onSaved={setEvent}
    />
  );
}
