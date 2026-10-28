import { fieldClass } from "@/components/ui/Field";
import type { TicketTypeInput } from "@/lib/api/types";
import { calculateBookingFeeCents, calculateOrderSummary, describeBookingFee } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { MAX_TICKET_DESCRIPTION_LENGTH } from "./draft";

/**
 * One ticket type's fields (docs/design/event-editor.md §5.6): name, price, who pays the booking fee,
 * quantity, and the optional description buyers see under the name. A block, not a nested box: the
 * second and later ones are ruled off. Prices are the all-inclusive amounts from lib/fees.ts.
 */
export default function TicketTypeFields({
  ticket,
  index,
  count,
  isAdmin,
  errors,
  onChange,
  onRemove,
}: {
  ticket: TicketTypeInput;
  index: number;
  /** How many ticket types there are (Remove only shows when there's more than one). */
  count: number;
  isAdmin: boolean;
  errors: Record<string, string>;
  onChange: (patch: Partial<TicketTypeInput>) => void;
  onRemove: () => void;
}) {
  const summary = calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy);
  const field = (name: "name" | "price" | "qty") => `ticket-${index}-${name}`;
  /** A field's error wiring: aria-invalid, and aria-describedby pointing at its error, while it has one. */
  const invalid = (key: string) => ({
    "aria-invalid": errors[key] ? (true as const) : undefined,
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  });
  const error = (key: string) =>
    errors[key] ? (
      <p id={`${key}-error`} className="text-sm text-danger">
        {errors[key]}
      </p>
    ) : null;
  const description = ticket.description ?? "";
  return (
    <div className={`flex flex-col gap-3 ${index > 0 ? "border-t border-surface-border pt-5" : ""}`.trim()}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-muted">Ticket {index + 1}</p>
        {count > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-11 items-center text-sm text-danger underline underline-offset-2"
          >
            Remove this ticket type
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={field("name")} className="eyebrow text-muted">
            Name
          </label>
          <input
            id={field("name")}
            value={ticket.name}
            onChange={(e) => onChange({ name: e.target.value })}
            {...invalid(field("name"))}
            className={fieldClass}
          />
          {error(field("name"))}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field("price")} className="eyebrow text-muted">
            Price (A$)
          </label>
          <input
            id={field("price")}
            type="number"
            min={0}
            step={0.5}
            value={ticket.priceCents / 100}
            onChange={(e) => onChange({ priceCents: Math.round(Number(e.target.value) * 100) || 0 })}
            {...invalid(field("price"))}
            className={fieldClass}
          />
          {error(field("price"))}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`ticket-${index}-fee-policy`} className="eyebrow text-muted">
            Who pays the booking fee?
          </label>
          <select
            id={`ticket-${index}-fee-policy`}
            value={ticket.feePolicy}
            onChange={(e) => onChange({ feePolicy: e.target.value as TicketTypeInput["feePolicy"] })}
            aria-describedby={`ticket-${index}-fee-help`}
            className={fieldClass}
          >
            <option value="buyer-pays">Buyer pays</option>
            <option value="organiser-absorbs">Organiser absorbs</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field("qty")} className="eyebrow text-muted">
            Quantity available
          </label>
          <input
            id={field("qty")}
            type="number"
            min={1}
            value={ticket.quantityAvailable}
            onChange={(e) => onChange({ quantityAvailable: Number(e.target.value) || 0 })}
            {...invalid(field("qty"))}
            className={fieldClass}
          />
          {error(field("qty"))}
        </div>
        <div className="sm:col-span-2">
          <FeePolicyHelp id={`ticket-${index}-fee-help`} priceCents={ticket.priceCents} isAdmin={isAdmin} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={`ticket-${index}-description`} className="eyebrow text-muted">
            Description (optional)
          </label>
          <textarea
            id={`ticket-${index}-description`}
            rows={2}
            maxLength={MAX_TICKET_DESCRIPTION_LENGTH}
            value={description}
            onChange={(e) => onChange({ description: e.target.value })}
            aria-describedby={`ticket-${index}-description-hint`}
            className={fieldClass}
          />
          <div className="flex items-start justify-between gap-3">
            <p id={`ticket-${index}-description-hint`} className="text-xs leading-4 text-muted">
              Shown under the ticket name.
            </p>
            <p className="meta shrink-0 text-muted tabular-nums">
              {description.length}/{MAX_TICKET_DESCRIPTION_LENGTH}
            </p>
          </div>
        </div>
      </div>
      <p className="text-sm leading-5 text-foreground">
        {ticket.priceCents === 0 ? (
          "Free — no booking fee."
        ) : (
          <>
            Buyer pays <span className="font-semibold tabular-nums">{formatAud(summary.totalCents)}</span> total (
            {formatAud(ticket.priceCents)} ticket
            {summary.buyerFeeCents > 0
              ? ` + ${formatAud(summary.buyerFeeCents)} booking fee`
              : isAdmin
                ? ", fee absorbed by the organiser"
                : ", fee absorbed by you"}
            ).
          </>
        )}
      </p>
    </div>
  );
}

/**
 * What each booking-fee choice means for this ticket, in plain words, under
 * "Who pays the booking fee?". Amounts come from lib/fees.ts.
 */
function FeePolicyHelp({ id, priceCents, isAdmin }: { id: string; priceCents: number; isAdmin: boolean }) {
  const you = isAdmin ? "the organiser receives" : "you receive";
  if (priceCents <= 0) {
    return (
      <p id={id} className="text-xs text-muted">
        Free tickets have no booking fee, so this choice doesn&rsquo;t apply.
      </p>
    );
  }
  const fee = calculateBookingFeeCents(priceCents);
  const price = formatAud(priceCents);
  return (
    <div id={id} className="flex flex-col gap-1 text-xs text-muted">
      <p>Sheltüh&rsquo;s booking fee is {describeBookingFee()}: {formatAud(fee)} on this ticket.</p>
      <p>
        <span className="font-semibold text-foreground">Buyer pays:</span> the fee is added on top. The buyer pays{" "}
        {formatAud(priceCents + fee)} and {you} the full {price}.
      </p>
      <p>
        <span className="font-semibold text-foreground">Organiser absorbs:</span> the buyer pays just {price} and the fee
        comes out of it, so {you} {formatAud(Math.max(priceCents - fee, 0))}.
      </p>
      <p>Card processing costs are covered by Sheltüh either way.</p>
    </div>
  );
}
