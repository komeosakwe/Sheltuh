"use client";

import { useState } from "react";
import SeatLine from "@/components/seating/SeatLine";
import type { OrderPaymentLine, OrderPaymentSummary as Summary } from "@/lib/api/types";
import { eventZone, formatAud, formatEventWhen } from "@/lib/format";
import { placeName } from "@/lib/place";
import { REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { ChevronDownIcon } from "./icons";

/**
 * What the buyer is paying for, beside Stripe's form
 * (docs/design/checkout-pay.md §5.3). Every amount comes from the server
 * (priced from the order with lib/fees.ts), never worked out here. The
 * all-inclusive total is the loudest number and is never collapsed; on
 * phones only the lines fold away behind "Show n tickets". The event's
 * refund policy follows the total.
 */
export default function OrderPaymentSummary({ summary }: { summary: Summary }) {
  const [open, setOpen] = useState(false);
  // In the event's zone, naming it outside Melbourne's ("… 11:00 pm Perth time").
  const zone = eventZone(summary.eventTimeZone);
  const when = summary.eventStartsAt
    ? formatEventWhen(summary.eventStartsAt, summary.eventEndsAt, summary.eventTimeZone, summary.eventState)
    : undefined;
  const where =
    [summary.venueName, summary.suburb ? placeName(summary.suburb, summary.eventState) : ""]
      .filter((part) => !!part?.trim())
      .join(", ") || undefined;
  const count = summary.lines.reduce((sum, line) => sum + line.quantity, 0);
  // "Seats" only when every line is seats (a seated order can carry general admission tickets too).
  const allSeats = summary.seated && summary.lines.length > 0 && summary.lines.every((line) => (line.seats?.length ?? 0) > 0);
  const refunds = refundTermsLine(summary.refundPolicy, summary.refundDays, summary.eventStartsAt, { timeZone: zone });
  const noun = allSeats ? (count === 1 ? "seat" : "seats") : count === 1 ? "ticket" : "tickets";

  return (
    <section
      aria-labelledby="order-summary"
      className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="order-summary" className="font-heading text-lg leading-6 break-words text-foreground">
          {summary.eventTitle}
        </h2>
        {when && <p className="text-sm text-pretty text-muted">{when}</p>}
        {where && <p className="text-sm text-muted">{where}</p>}
      </div>

      {/* Phones: the lines fold away (the total below never does). From lg they always show. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="order-lines"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between text-sm text-foreground lg:hidden"
      >
        <span>{open ? `Hide ${allSeats ? "seats" : "tickets"}` : `Show ${count} ${noun}`}</span>
        <ChevronDownIcon className={`size-4 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      <div id="order-lines" className={open ? "block" : "hidden lg:block"}>
        <ul className="flex flex-col">
          {summary.lines.map((line, index) => (
            <li
              key={`${line.ticketTypeName}-${index}`}
              className="flex flex-col border-t border-surface-border py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex justify-between gap-4">
                <div className="flex min-w-0 flex-col">
                  <p className="text-sm font-semibold break-words text-foreground">{line.ticketTypeName}</p>
                  <p className="meta text-muted tabular-nums">
                    {line.quantity} &times; {unitLabel(line)}
                  </p>
                </div>
                <p className="shrink-0 text-sm whitespace-nowrap tabular-nums text-foreground">
                  {line.lineTotalCents > 0 ? formatAud(line.lineTotalCents) : "Free"}
                </p>
              </div>
              {/* The seats use the line's full width, under the amount too. */}
              {line.seats?.map((seat) => (
                <SeatLine key={`${seat.section}|${seat.row}|${seat.seat}`} seat={seat} className="meta text-muted" />
              ))}
            </li>
          ))}
        </ul>
      </div>

      <div>
        {/* The largest number on the page (brand-direction-one.md §6.8): the label wraps, never the amount. */}
        <div className="flex items-baseline justify-between gap-4 border-t border-foreground pt-3">
          <p className="text-lg leading-6 font-bold text-foreground">Total</p>
          <p data-order-total="" className="shrink-0 text-xl leading-7 font-bold whitespace-nowrap tabular-nums text-foreground">
            {formatAud(summary.totalCents)}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          {summary.buyerFeeCents > 0
            ? `Includes ${formatAud(summary.buyerFeeCents)} in booking fees.`
            : "No booking fee."}
        </p>
      </div>

      {/* The event's refund policy, before paying (lib/refund-policy.ts). Nothing when an older response has none. */}
      {refunds && (
        <div data-refund-policy="" className="flex flex-col gap-1 border-t border-surface-border pt-3 text-sm">
          <p className="text-foreground">
            <span className="font-semibold">Refund policy:</span> {refunds}
          </p>
          <p className="text-sm text-muted">{REFUND_ACL_STATEMENT}</p>
        </div>
      )}
    </section>
  );
}

/** One ticket's all-inclusive price; "incl. fee" only on a line whose buyer pays one (an organiser can absorb it). */
function unitLabel(line: OrderPaymentLine): string {
  if (line.unitTotalCents <= 0) return "Free";
  return line.buyerPaysFee ? `${formatAud(line.unitTotalCents)} incl. fee` : formatAud(line.unitTotalCents);
}
