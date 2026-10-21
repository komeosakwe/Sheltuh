"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import EventEditor from "@/components/dashboard/EventEditor";
import { ButtonLink } from "@/components/ui/Button";
import { getMyEvent } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";

export default function EditEventPageContent() {
  const auth = useAuth();
  const params = useParams<{ eventId: string }>();
  const { loading: organiserLoading, organiser } = useOrganiser();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = auth.status === "signed-in" && organiser?.status === "approved";
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getMyEvent(params.eventId, getToken)
      .then((record) => {
        if (!cancelled) setEvent(record);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this event.");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, getToken, params.eventId]);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
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

  if (!event) {
    return <LoadingState text="Loading event…" />;
  }

  return (
    <>
      <ButtonLink
        variant="outline"
        size="sm"
        className="min-h-11 w-fit"
        href={`/dashboard/events/${encodeURIComponent(event.eventId)}/analytics`}
      >
        Analytics
      </ButtonLink>
      <EventEditor getToken={getToken} initial={event} onSaved={setEvent} />
    </>
  );
}
