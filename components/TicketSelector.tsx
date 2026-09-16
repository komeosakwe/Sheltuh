"use client";

import { useMemo, useState } from "react";
import { calculateOrderSummary } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import type { TicketType } from "@/lib/types";

const MAX_QUANTITY_PER_TYPE = 8;

export default function TicketSelector({ ticketTypes }: { ticketTypes: TicketType[] }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  function quantityFor(ticketId: string): number {
    return quantities[ticketId] ?? 0;
  }

  function setQuantity(ticketId: string, value: number) {
    const cap = ticketTypes.find((t) => t.id === ticketId)?.quantityAvailable ?? MAX_QUANTITY_PER_TYPE;
    const clamped = Math.max(0, Math.min(value, Math.min(cap, MAX_QUANTITY_PER_TYPE)));
    setQuantities((prev) => ({ ...prev, [ticketId]: clamped }));
  }

  const lineSummaries = useMemo(
    () =>
      ticketTypes.map((ticket) => {
        const quantity = quantities[ticket.id] ?? 0;
        return {
          ticket,
          quantity,
          summary: calculateOrderSummary(ticket.priceCents, quantity, ticket.feePolicy),
        };
      }),
    [ticketTypes, quantities],
  );

  const orderTotal = lineSummaries.reduce(
    (acc, line) => ({
      subtotalCents: acc.subtotalCents + line.summary.subtotalCents,
      buyerFeeCents: acc.buyerFeeCents + line.summary.buyerFeeCents,
      totalCents: acc.totalCents + line.summary.totalCents,
    }),
    { subtotalCents: 0, buyerFeeCents: 0, totalCents: 0 },
  );

  const hasAnyTickets = lineSummaries.some((line) => line.quantity > 0);

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-4">
        {ticketTypes.map((ticket) => {
          const isFree = ticket.priceCents === 0;
          const quantity = quantityFor(ticket.id);
          const cap = Math.min(ticket.quantityAvailable, MAX_QUANTITY_PER_TYPE);
          return (
            <li
              key={ticket.id}
              className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex-1">
                <p className="font-semibold text-foreground">{ticket.name}</p>
                {ticket.description && (
                  <p className="text-sm text-muted">{ticket.description}</p>
                )}
                <p className="mt-1 text-sm text-foreground">
                  {isFree ? "Free" : formatAud(ticket.priceCents)}
                  {!isFree && ticket.feePolicy === "buyer-pays" && (
                    <span className="text-muted"> + booking fee</span>
                  )}
                  {!isFree && ticket.feePolicy === "organiser-absorbs" && (
                    <span className="text-muted"> · booking fee included</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={`qty-${ticket.id}`} className="text-sm text-muted">
                  Quantity
                </label>
                <input
                  id={`qty-${ticket.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={cap}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(ticket.id, Number(event.target.value))}
                  className="w-20 rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                  aria-label={`Quantity for ${ticket.name}`}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h3 className="font-heading text-xl text-foreground">Order summary</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Ticket subtotal</dt>
            <dd className="text-foreground">{formatAud(orderTotal.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Booking fees (you pay)</dt>
            <dd className="text-foreground">{formatAud(orderTotal.buyerFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-surface-border pt-2 font-semibold">
            <dt className="text-foreground">Total</dt>
            <dd className="text-foreground">{formatAud(orderTotal.totalCents)}</dd>
          </div>
        </dl>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-4 w-full cursor-not-allowed rounded bg-surface-border px-4 py-3 font-medium text-muted"
        >
          Checkout unavailable in this demo
        </button>
        <p className="mt-2 text-xs text-muted">
          This is a local prototype. No payment information is collected and no tickets are
          issued{hasAnyTickets ? " — the total above is a preview only." : "."}
        </p>
      </div>
    </div>
  );
}
