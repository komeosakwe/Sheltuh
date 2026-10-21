"use client";

import Link from "next/link";
import DemoNotice from "@/components/DemoNotice";
import { useEffect, useState, type ReactNode } from "react";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { getMyEvent } from "@/lib/api/events";
import { deleteSeatMap, getSeatMap, saveSeatMap } from "@/lib/api/seating";
import type { EventRecord, SeatMapRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { adaptPublicEvent } from "@/lib/live/adapt";
import SeatMapEditor, { type SeatMapStatus } from "./SeatMapEditor";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; event: EventRecord; map: SeatMapRecord | null };

/** The editor's status badge and whether the organiser can still change the map (docs/architecture.md, "Reserved seating"). */
export function seatMapAccess(event: Pick<EventRecord, "status" | "ticketingLocked">): { status: SeatMapStatus; locked: boolean; message: string } {
  if (event.ticketingLocked || event.status === "published") {
    return { status: "Approved · locked", locked: true, message: "This seat map is locked because the event is approved. To change it, contact Sheltüh." };
  }
  if (event.status === "pending_review") {
    return { status: "In review", locked: true, message: "The event is in review, so its seat map can’t be changed right now." };
  }
  return { status: "Draft", locked: false, message: "" };
}

/** /dashboard/[eventId]/seat-map: loads the organiser's event and its map (none yet is fine), then the editor. */
export default function SeatMapEditorPage({ eventId }: { eventId: string }) {
  const auth = useAuth();
  const { loading: organiserLoading, organiser } = useOrganiser();
  const [state, setState] = useState<State>({ status: "loading" });
  const ready = auth.status === "signed-in" && organiser?.status === "approved";
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const event = await getMyEvent(eventId, getToken);
        let map: SeatMapRecord | null = null;
        try {
          map = await getSeatMap(eventId, undefined, getToken);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        if (!cancelled) setState({ status: "ready", event, map });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "Couldn’t load this event." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, eventId, getToken]);

  const frame = (children: ReactNode) => <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">{children}</div>;

  if (!auth.configured) {
    // Demo mode isn't a fault: say what this is, neutrally.
    return frame(
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-heading text-2xl">Seat map</h1>
        <DemoNotice>Organiser tools need the live service, which isn&rsquo;t connected here.</DemoNotice>
        <Notice>Seat maps are drawn here by organisers once accounts are available. To see one, open a seated sample event and choose seats.</Notice>
      </div>,
    );
  }
  if (auth.status === "loading" || organiserLoading) return frame(<LoadingState text="Loading…" />);
  if (!ready) {
    return frame(
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3">You need an approved organiser application to manage events.</p>
        <Link href="/organisers/apply" className="btn btn-solid">
          Apply as an organiser
        </Link>
      </div>,
    );
  }
  if (state.status === "loading") return frame(<LoadingState text="Loading seat map…" />);
  if (state.status === "error") {
    return frame(
      <Notice tone="danger" role="alert">
        {state.message}
      </Notice>,
    );
  }
  const { event, map } = state;
  if (event.ticketingMode === "external") {
    return frame(
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl">Seat map</h1>
        <Notice>Seat maps are for events ticketed on Sheltüh. This event&rsquo;s tickets are sold on another site.</Notice>
        <Link href={`/dashboard/${encodeURIComponent(eventId)}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
          Back to the event
        </Link>
      </div>,
    );
  }
  const access = seatMapAccess(event);
  return (
    <div>
      <div className="px-4 pt-3">
        <Link href={`/dashboard/${encodeURIComponent(eventId)}`} className="eyebrow inline-flex min-h-11 items-center underline underline-offset-4">
          &larr; {event.title}
        </Link>
      </div>
      <SeatMapEditor
        event={adaptPublicEvent(event)}
        initial={map}
        status={access.status}
        locked={access.locked}
        lockedMessage={access.message}
        onSave={(template) => saveSeatMap(eventId, template, getToken)}
        onRemove={() => deleteSeatMap(eventId, getToken)}
      />
    </div>
  );
}
