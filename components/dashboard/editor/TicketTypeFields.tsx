import { fieldClass } from "@/components/ui/Field";
import type { TicketTypeInput } from "@/lib/api/types";
import { calculateBookingFeeCents, calculateOrderSummary, describeBookingFee } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { admitsOf, groupsIn, groupOfLabel, MAX_GROUP_SIZE } from "@/lib/ticket-groups";
import { admitsPatch, groupDisabledReason, MAX_TICKET_DESCRIPTION_LENGTH } from "./draft";

/** What decides whether a ticket's "People per ticket" shows and can change (group tickets, behind NEXT_PUBLIC_GROUP_TICKETS). */
export interface GroupContext {
  /** The flag is on (and the organiser can sell paid tickets). Off: only an existing group ticket shows it, read-only. */
  enabled: boolean;
  /** The event has (or is getting) a seat map: group tickets and seats exclude each other. */
  reservedSeating: boolean;
  /** People sold on this ticket type (`ticketsSold`): its size is frozen once there are any. */
  sold: number;
}

const PEOPLE_OPTIONS = Array.from({ length: MAX_GROUP_SIZE }, (_, i) => i + 1);

/**
 * One ticket type's fields (docs/design/event-editor.md §5.6): name, price, who pays the booking fee,
 * quantity, and the optional description buyers see under the name. A block, not a nested box: the
 * second and later ones are ruled off. Prices are the all-inclusive amounts from lib/fees.ts.
 *
 * A group ticket (one ticket that admits several people) keeps its capacity in PEOPLE (as the API does):
 * above 1 person per ticket, the quantity field is groups (people = groups x people per ticket).
 */
export default function TicketTypeFields({
  ticket,
  index,
  count,
  isAdmin,
  errors,
  groups,
  onChange,
  onRemove,
}: {
  ticket: TicketTypeInput;
  index: number;
  /** How many ticket types there are (Remove only shows when there's more than one). */
  count: number;
  isAdmin: boolean;
  errors: Record<string, string>;
  groups: GroupContext;
  onChange: (patch: Partial<TicketTypeInput>) => void;
  onRemove: () => void;
}) {
  const summary = calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy);
  const field = (name: "name" | "price" | "qty" | "lock" | "admits") => `ticket-${index}-${name}`;
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
  // Sequential release: only a general admission ticket after the first can wait for the one above it.
  const canWait = index > 0 && ticket.seated !== true;
  const admits = admitsOf(ticket);
  const isGroup = admits > 1;
  // Off, only a group ticket that already exists shows its size (read-only); otherwise it's not shown at all.
  const showPeople = groups.enabled || isGroup;
  const peopleReason = groupDisabledReason(ticket, groups);
  const groupCount = groupsIn(ticket, Math.max(ticket.quantityAvailable, 0));
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
            {isGroup ? "Price per group (A$)" : "Price (A$)"}
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
        {showPeople ? (
          <>
        {showPeople && (
          <div className="flex flex-col gap-1">
            <label htmlFor={field("admits")} className="eyebrow text-muted">
              People per ticket
            </label>
            <select
              id={field("admits")}
              value={admits}
              disabled={peopleReason !== null}
              onChange={(e) => onChange(admitsPatch(ticket, Number(e.target.value)))}
              aria-describedby={
                [peopleReason ? `${field("admits")}-hint` : null, errors[field("admits")] ? `${field("admits")}-error` : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-invalid={errors[field("admits")] ? true : undefined}
              className={fieldClass}
            >
              {PEOPLE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {peopleReason && (
              <p id={`${field("admits")}-hint`} className="meta text-muted">
                {peopleReason}
              </p>
            )}
            {error(field("admits"))}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={field("qty")} className="eyebrow text-muted">
            {isGroup ? "Groups available" : "Quantity available"}
          </label>
          <input
            id={field("qty")}
            type="number"
            min={1}
            value={isGroup ? groupCount : ticket.quantityAvailable}
            onChange={(e) => {
              const typed = Number(e.target.value) || 0;
              onChange({ quantityAvailable: typed * admits });
            }}
            aria-invalid={errors[field("qty")] ? true : undefined}
            aria-describedby={
              [isGroup ? `${field("qty")}-hint` : null, errors[field("qty")] ? `${field("qty")}-error` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className={fieldClass}
          />
          {isGroup && (
            <p id={`${field("qty")}-hint`} className="meta text-muted tabular-nums">
              {groupCount * admits} people in total
            </p>
          )}
          {error(field("qty"))}
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
            <option value="organiser-absorbs">Organiser pays</option>
            <option value="buyer-pays">Buyer pays</option>
          </select>
        </div>
          </>
        ) : (
          <>
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
            <option value="organiser-absorbs">Organiser pays</option>
            <option value="buyer-pays">Buyer pays</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field("qty")} className="eyebrow text-muted">
            {isGroup ? "Groups available" : "Quantity available"}
          </label>
          <input
            id={field("qty")}
            type="number"
            min={1}
            value={isGroup ? groupCount : ticket.quantityAvailable}
            onChange={(e) => {
              const typed = Number(e.target.value) || 0;
              onChange({ quantityAvailable: typed * admits });
            }}
            aria-invalid={errors[field("qty")] ? true : undefined}
            aria-describedby={
              [isGroup ? `${field("qty")}-hint` : null, errors[field("qty")] ? `${field("qty")}-error` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className={fieldClass}
          />
          {isGroup && (
            <p id={`${field("qty")}-hint`} className="meta text-muted tabular-nums">
              {groupCount * admits} people in total
            </p>
          )}
          {error(field("qty"))}
        </div>
          </>
        )}
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
        {canWait && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={field("lock")} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input
                id={field("lock")}
                type="checkbox"
                checked={ticket.opensAfterPrevious === true}
                onChange={(e) => onChange({ opensAfterPrevious: e.target.checked })}
                {...invalid(field("lock"))}
              />
              Opens when the ticket above sells out
            </label>
            {error(field("lock"))}
          </div>
        )}
      </div>
      <p className="text-sm leading-5 text-foreground">
        {ticket.priceCents === 0 ? (
          "Free — no booking fee."
        ) : (
          <>
            Buyer pays <span className="font-semibold tabular-nums">{formatAud(summary.totalCents)}</span> total
            {isGroup ? ` per ${groupOfLabel(admits).toLowerCase()}` : ""} (
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
