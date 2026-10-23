"use client";

import { stepperButtonClass } from "@/components/ui/stepper";
import { formatTicketHeadline } from "@/lib/pricing";
import { ownLimit, ownLimitHint, type Quantities } from "@/lib/ticket-limits";
import type { TicketType } from "@/lib/types";

/**
 * General admission tiers of a mixed event, as steppers in the seat page's
 * summary (docs/design/seating.md §5.10 item 4; manager decision 5: they
 * don't count towards the 10 seats). Limits and messages are the ticket
 * selector's (lib/ticket-limits.ts); `capFor` adds the free-ticket cap
 * shared with free seats. The page owns the quantities and announces changes.
 */
export default function GeneralAdmissionSteppers({
  tiers,
  quantities,
  capFor,
  onChange,
  idPrefix,
}: {
  tiers: TicketType[];
  quantities: Quantities;
  capFor: (ticket: TicketType) => { cap: number; reason: string };
  onChange: (ticket: TicketType, value: number) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col">
      <h3 className="eyebrow text-muted">General admission</h3>
      <ul className="mt-2 flex flex-col">
        {tiers.map((ticket, index) => {
          const quantity = quantities[ticket.id] ?? 0;
          const { cap } = capFor(ticket);
          const hintId = `${idPrefix}-ga-${index}`;
          const soldOut = ticket.soldOut === true;
          return (
            <li
              key={ticket.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border py-3 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{ticket.name}</p>
                <p className={`text-sm font-semibold tabular-nums ${soldOut ? "text-muted" : ""}`}>{formatTicketHeadline(ticket)}</p>
                {!soldOut && (
                  <p id={hintId} className="text-xs text-muted">
                    Standing. {ownLimit(ticket) > 0 ? ownLimitHint(ticket) : ""}
                  </p>
                )}
              </div>
              {soldOut ? (
                <p className="eyebrow shrink-0">Sold out</p>
              ) : (
                <div role="group" aria-label={`Quantity for ${ticket.name}`} className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChange(ticket, quantity - 1)}
                    aria-disabled={quantity <= 0}
                    aria-label={`Decrease quantity for ${ticket.name}`}
                    className={stepperButtonClass}
                  >
                    &minus;
                  </button>
                  <span className="w-10 text-center text-lg leading-6 font-semibold tabular-nums">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => onChange(ticket, quantity + 1)}
                    aria-disabled={quantity >= cap}
                    aria-label={`Increase quantity for ${ticket.name}`}
                    aria-describedby={hintId}
                    className={stepperButtonClass}
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
