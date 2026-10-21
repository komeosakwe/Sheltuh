"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ImportDialog from "@/components/seating/editor/ImportExport";
import SeatMapEditor from "@/components/seating/editor/SeatMapEditor";
import SeatDialog from "@/components/seating/SeatDialog";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { adminGetEvent } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { adminSaveSeatMap, getSeatMap } from "@/lib/api/seating";
import type { AdminEventRecord, SeatMapRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SeatMapTemplate } from "@/lib/seating/template";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; event: AdminEventRecord; map: SeatMapRecord | null; generation: number };

/** An admin action's error, in words (409: the event has orders, or is external). */
function adminError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return err.fieldErrors?.template ?? err.message ?? "Can’t replace: this event has orders.";
    if (err.fieldErrors) return Object.values(err.fieldErrors).join(" ") || err.message;
    return err.message;
  }
  return "Couldn’t save just now. Try again.";
}

/**
 * /admin/events/[eventId]/seat-map (docs/design/seating.md §5.14): the map
 * in the read-only editor (with Preview as buyer), and the admin's
 * replace and remove, allowed only while the event has no orders and
 * logged with a reason. Whether there are orders is the API's answer (a
 * 409), shown in place.
 */
export default function AdminSeatMap({ eventId }: { eventId: string }) {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [state, setState] = useState<State>({ status: "loading" });
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Removing the map removes its Remove button: focus comes back to Replace instead.
  const replaceRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const event = await adminGetEvent(eventId, getToken);
      let map: SeatMapRecord | null = null;
      try {
        map = await getSeatMap(eventId, undefined, getToken);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      setState((prev) => ({ status: "ready", event, map, generation: prev.status === "ready" ? prev.generation + 1 : 0 }));
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Couldn’t load this event." });
    }
  }, [eventId, getToken]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function replace(template: SeatMapTemplate | null, reason: string): Promise<string | null> {
    try {
      await adminSaveSeatMap(eventId, template, reason, getToken);
      setNotice(template ? "Seat map replaced. The change is logged." : "Seat map removed. The change is logged.");
      await load();
      return null;
    } catch (err) {
      return adminError(err);
    }
  }

  if (state.status === "loading") return <div className="px-5 py-12 sm:px-8"><LoadingState text="Loading seat map…" /></div>;
  if (state.status === "error") {
    return (
      <div className="px-5 py-12 sm:px-8">
        <Notice tone="danger" role="alert">
          {state.message}
        </Notice>
      </div>
    );
  }
  const { event, map } = state;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <Link href={`/admin/events/${encodeURIComponent(eventId)}/edit`} className="eyebrow inline-flex min-h-11 items-center underline underline-offset-4">
          &larr; {event.title}
        </Link>
        <span className="flex-1" />
        {event.ticketingMode !== "external" && (
          <Button ref={replaceRef} variant="outline" size="sm" className="min-h-10" onClick={() => setReplaceOpen(true)}>
            Replace seat map
          </Button>
        )}
        {map && (
          <Button variant="danger" size="sm" className="min-h-10" onClick={() => setRemoveOpen(true)}>
            Remove seat map
          </Button>
        )}
      </div>
      <p className="px-4 text-xs text-muted">Only while the event has no orders. Every change is logged with its reason, and the organiser sees it.</p>
      {notice && (
        <div className="px-4 pt-3">
          <Notice role="status">{notice}</Notice>
        </div>
      )}
      {map ? (
        <SeatMapEditor
          key={`${map.version}-${state.generation}`}
          event={adaptPublicEvent(event)}
          initial={map}
          status={event.status === "published" || event.ticketingLocked ? "Approved · locked" : event.status === "pending_review" ? "In review" : "Draft"}
          locked
          lockedMessage="Read-only. To change this map, replace it with an imported one."
          onSave={() => Promise.reject(new Error("Read-only."))}
        />
      ) : (
        <div className="px-4 py-8">
          <Notice>This event has no seat map: it&rsquo;s general admission.</Notice>
        </div>
      )}

      <ImportDialog
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        title="Replace seat map"
        ticketTypeIds={event.ticketTypes.map((t) => t.id)}
        requireReason
        onReplace={(template, reason) => replace(template, reason)}
      />
      <SeatDialog open={removeOpen} title="Remove the seat map?" onClose={() => setRemoveOpen(false)} fallbackFocus={replaceRef}>
        <RemoveForm
          onCancel={() => setRemoveOpen(false)}
          onRemove={async (reason) => {
            const message = await replace(null, reason);
            if (!message) setRemoveOpen(false);
            return message;
          }}
        />
      </SeatDialog>
    </div>
  );
}

function RemoveForm({ onCancel, onRemove }: { onCancel: () => void; onRemove: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim()) return setError("Give a reason. It’s logged, and the organiser sees it.");
        setBusy(true);
        const message = await onRemove(reason.trim());
        setBusy(false);
        if (message) setError(message);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-base">The event goes back to general admission.</p>
      <label htmlFor="remove-map-reason" className="eyebrow text-muted">
        Reason (logged)
      </label>
      <textarea
        id="remove-map-reason"
        value={reason}
        maxLength={500}
        rows={3}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "remove-map-error" : undefined}
        className="px-3 py-2 text-base sm:text-sm"
      />
      {error && (
        <p id="remove-map-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" variant="danger" busy={busy}>
          Remove map
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
