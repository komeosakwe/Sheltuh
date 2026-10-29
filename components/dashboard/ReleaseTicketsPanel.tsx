"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { ApiError, type GetToken } from "@/lib/api/client";
import { releaseTickets } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";

/**
 * Whether an organiser can raise a ticket type's total here (the server
 * rechecks, private.release_tickets): their own published, Sheltüh-ticketed,
 * not-yet-ended event, and a general admission tier (a seated tier follows
 * its seat map, so it isn't listed).
 */
export function releasableTicketTypes(event: EventRecord, now = Date.now()): EventRecord["ticketTypes"] {
  if (event.status !== "published" || event.ticketingMode === "external") return [];
  if (Date.parse(event.endsAt) <= now) return [];
  return event.ticketTypes.filter((ticket) => ticket.seated !== true);
}

/** Sold / total per general admission ticket type, each with a "release more" control (raise the total, never lower it). */
export default function ReleaseTicketsPanel({ event, getToken }: { event: EventRecord; getToken: GetToken }) {
  const tickets = releasableTicketTypes(event);
  // Totals and sales as last confirmed by the server, by ticket type id.
  const [totals, setTotals] = useState<Record<string, { total: number; sold: number }>>({});
  if (tickets.length === 0) return null;
  return (
    <section aria-labelledby="release-tickets-title" className="rounded-card border border-foreground bg-card p-4 sm:p-5">
      <h2 id="release-tickets-title" className="font-heading text-xl">
        Release more tickets
      </h2>
      <ul className="mt-3 divide-y divide-foreground/15">
        {tickets.map((ticket) => {
          const now = totals[ticket.id];
          return (
            <ReleaseRow
              key={ticket.id}
              eventId={event.eventId}
              ticketTypeId={ticket.id}
              name={ticket.name}
              total={now?.total ?? ticket.quantityAvailable}
              sold={now?.sold ?? event.ticketsSold?.[ticket.id] ?? 0}
              getToken={getToken}
              onReleased={(total, sold) => setTotals((all) => ({ ...all, [ticket.id]: { total, sold } }))}
            />
          );
        })}
      </ul>
    </section>
  );
}

function ReleaseRow({
  eventId,
  ticketTypeId,
  name,
  total,
  sold,
  getToken,
  onReleased,
}: {
  eventId: string;
  ticketTypeId: string;
  name: string;
  total: number;
  sold: number;
  getToken: GetToken;
  onReleased: (total: number, sold: number) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const inputId = `release-${ticketTypeId}`;
  const errorId = `${inputId}-error`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next = Number(value);
    setDone(null);
    if (value.trim() === "" || !Number.isInteger(next) || next <= total) {
      setError(`Enter more than ${total}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await releaseTickets(eventId, ticketTypeId, next, getToken);
      onReleased(result.quantityAvailable, result.quantitySold);
      setDone(result.quantityAvailable);
      setValue("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fieldErrors?.quantityAvailable ?? err.message)
          : "Couldn’t release tickets. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-semibold">{name}</p>
        <p className="text-sm text-muted">
          {sold} sold / {total}
        </p>
      </div>
      <form onSubmit={submit} noValidate className="mt-2 flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-48">
          <label htmlFor={inputId} className="eyebrow text-muted">
            New total
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={total + 1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder={String(total + 1)}
            className={`${fieldClass} min-h-11`}
          />
        </div>
        <Button type="submit" busy={busy} className="min-h-11">
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      {done !== null && (
        <p role="status" className="mt-1 text-sm">
          Released. Now {done} on sale.
        </p>
      )}
    </li>
  );
}
