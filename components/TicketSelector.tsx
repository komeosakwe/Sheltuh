"use client";

import { useMemo, useState } from "react";
import { calculateOrderSummary } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { formatTicketBreakdown, formatTicketHeadline } from "@/lib/pricing";
import type { TicketType } from "@/lib/types";

const MAX_QUANTITY_PER_TYPE = 8;

const stepperButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded border border-surface-border text-lg font-semibold text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-border disabled:hover:text-foreground";

export default function TicketSelector({ ticketTypes }: { ticketTypes: TicketType[] }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  function capFor(ticket: TicketType): number {
    return Math.min(ticket.quantityAvailable, MAX_QUANTITY_PER_TYPE);
  }

  function setQuantity(ticket: TicketType, value: number) {
    const clamped = Math.max(0, Math.min(value, capFor(ticket)));
    setQuantities((prev) => ({ ...prev, [ticket.id]: clamped }));
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
        {lineSummaries.map(({ ticket, quantity }) => {
          const cap = capFor(ticket);
          const breakdown = formatTicketBreakdown(ticket);
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
                <p className="mt-1 text-sm text-foreground">{formatTicketHeadline(ticket)}</p>
                {quantity > 0 && breakdown && (
                  <p className="mt-0.5 text-xs text-muted">{breakdown}</p>
                )}
              </div>
              <div
                role="group"
                aria-label={`Quantity for ${ticket.name}`}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity - 1)}
                  disabled={quantity <= 0}
                  aria-label={`Decrease quantity for ${ticket.name}`}
                  className={stepperButtonClass}
                >
                  &minus;
                </button>
                <span
                  aria-live="polite"
                  className="w-8 text-center text-base font-medium tabular-nums text-foreground"
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity + 1)}
                  disabled={quantity >= cap}
                  aria-label={`Increase quantity for ${ticket.name}`}
                  className={stepperButtonClass}
                >
                  +
                </button>
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
