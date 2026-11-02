"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError, type GetToken } from "@/lib/api/client";
import { setTicketLock } from "@/lib/api/events";
import type { EventRecord, TicketOpensAfter } from "@/lib/api/types";

/** A ticket type that can wait for the one above it, with that one's name. */
export interface LockableTicket {
  ticket: EventRecord["ticketTypes"][number];
  /** The ticket directly above it in the list. */
  above: EventRecord["ticketTypes"][number];
}

/**
 * The tickets whose release order an organiser can change here (the server
 * rechecks, private.set_ticket_lock): on their own published, Sheltüh-ticketed,
 * not-yet-ended event, each general admission ticket after the first (a seated
 * one follows its seat map, and the first has nothing above it).
 */
export function lockableTicketTypes(event: EventRecord, now = Date.now()): LockableTicket[] {
  if (event.status !== "published" || event.ticketingMode === "external") return [];
  if (Date.parse(event.endsAt) <= now) return [];
  const rows: LockableTicket[] = [];
  event.ticketTypes.forEach((ticket, index) => {
    if (index > 0 && ticket.seated !== true) rows.push({ ticket, above: event.ticketTypes[index - 1] });
  });
  return rows;
}

/** The setting and state of one ticket as last confirmed by the server. */
interface Confirmed {
  opensAfterPrevious: boolean;
  opensAfter: TicketOpensAfter | undefined;
}

/** "Opens when the ticket above sells out" per general admission ticket after the first, with whether it's waiting now. */
export default function TicketLockPanel({ event, getToken }: { event: EventRecord; getToken: GetToken }) {
  const rows = lockableTicketTypes(event);
  // What the server last said, by ticket type id (before any save: the record as loaded).
  const [confirmed, setConfirmed] = useState<Record<string, Confirmed>>({});
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="ticket-lock-title" className="rounded-card border border-foreground bg-card p-4 sm:p-5">
      <h2 id="ticket-lock-title" className="font-heading text-xl">
        Release order
      </h2>
      <ul className="mt-3 divide-y divide-foreground/15">
        {rows.map(({ ticket, above }) => (
          <LockRow
            key={ticket.id}
            eventId={event.eventId}
            ticketTypeId={ticket.id}
            name={ticket.name}
            aboveName={above.name}
            confirmed={confirmed[ticket.id] ?? { opensAfterPrevious: ticket.opensAfterPrevious === true, opensAfter: ticket.opensAfter }}
            getToken={getToken}
            onSaved={(next) => setConfirmed((all) => ({ ...all, [ticket.id]: next }))}
          />
        ))}
      </ul>
    </section>
  );
}

function LockRow({
  eventId,
  ticketTypeId,
  name,
  aboveName,
  confirmed,
  getToken,
  onSaved,
}: {
  eventId: string;
  ticketTypeId: string;
  name: string;
  aboveName: string;
  confirmed: Confirmed;
  getToken: GetToken;
  onSaved: (next: Confirmed) => void;
}) {
  // The box as ticked, until saved; null: as the server has it.
  const [ticked, setTicked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const checked = ticked ?? confirmed.opensAfterPrevious;
  const changed = checked !== confirmed.opensAfterPrevious;
  const inputId = `lock-${ticketTypeId}`;
  const errorId = `${inputId}-error`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !changed) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const result = await setTicketLock(eventId, ticketTypeId, checked, getToken);
      onSaved({ opensAfterPrevious: result.opensAfterPrevious, opensAfter: result.opensAfter });
      setTicked(null);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fieldErrors?.opensAfterPrevious ?? err.message)
          : "Couldn’t save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-semibold">{name}</p>
        {/* Words, not colour: waiting until the ticket above sells out, else on sale. */}
        <p className="text-sm text-muted">{confirmed.opensAfter ? "Waiting" : "On sale"}</p>
      </div>
      <form onSubmit={submit} noValidate className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={inputId} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setTicked(e.target.checked);
              setSaved(false);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          Opens after {aboveName}
        </label>
        <Button type="submit" busy={busy} aria-disabled={changed ? undefined : true} aria-label={`Save ${name}`} className="min-h-11">
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-1 text-sm">
          Saved.
        </p>
      )}
    </li>
  );
}
