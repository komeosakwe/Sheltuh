import { Panel } from "@/components/ui/Section";
import { formatAudExact, formatCount } from "@/lib/analytics-format";
import type { MoneyTotals, TicketTypeSales } from "@/lib/api/types";
import DataTable from "./DataTable";

function PriceCell({ type }: { type: TicketTypeSales }) {
  if (type.priceCents === undefined) return <span className="text-muted">No longer offered</span>;
  if (type.priceCents === 0) {
    return (
      <span className="flex flex-col items-end">
        Free
        <span className="text-xs text-muted">No booking fee</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      {formatAudExact(type.priceCents)}
      <span className="text-xs text-muted">
        {type.feePolicy === "organiser-absorbs" ? "You absorb the fee" : "Buyer pays fee"}
      </span>
    </span>
  );
}

/**
 * "42 of 100" with a bar, only for all time (sales in a shorter period
 * against total capacity would mislead). Otherwise just the count.
 */
function SoldCell({ type, wholeLife }: { type: TicketTypeSales; wholeLife: boolean }) {
  const capacity = type.quantityAvailable;
  if (!wholeLife || capacity === undefined || capacity <= 0) return <>{formatCount(type.ticketsSold)}</>;
  const full = type.ticketsSold >= capacity;
  return (
    <span className="inline-flex w-full flex-col items-end gap-1">
      <span>
        {formatCount(type.ticketsSold)} of {formatCount(capacity)}
        {full && " · Sold out"}
      </span>
      <span aria-hidden="true" className="block h-1 w-full max-w-24 bg-surface-border">
        <span className="block h-1 bg-foreground" style={{ width: `${Math.min(100, (type.ticketsSold / capacity) * 100)}%` }} />
      </span>
    </span>
  );
}

/** Sales per ticket type (§5.14). The rows always add up to the totals (the API reconciles them). */
export default function TicketTypeTable({
  types,
  totals,
  ticketsSold,
  wholeLife,
}: {
  types: TicketTypeSales[];
  totals: MoneyTotals;
  ticketsSold: number;
  /** The range is the event's whole life (All time). */
  wholeLife: boolean;
}) {
  return (
    <Panel title="By ticket type" titleId="by-ticket-type">
      {types.length === 0 ? (
        <p className="text-sm text-muted">This event has no ticket types.</p>
      ) : (
        <DataTable
          caption="Sales by ticket type"
          columns={[
            { key: "type", label: "Ticket type" },
            { key: "price", label: "Price", numeric: true },
            { key: "sold", label: "Sold", numeric: true },
            { key: "gross", label: "Gross", numeric: true },
            { key: "fees", label: "Fees", numeric: true },
            { key: "net", label: "Net", numeric: true },
          ]}
          rows={types.map((type) => ({
            key: type.ticketTypeId,
            header: type.name,
            cells: [
              <PriceCell key="p" type={type} />,
              <SoldCell key="s" type={type} wholeLife={wholeLife} />,
              formatAudExact(type.grossCents),
              formatAudExact(type.feesCents),
              formatAudExact(type.netCents),
            ],
          }))}
          totals={[
            "",
            formatCount(ticketsSold),
            formatAudExact(totals.grossCents),
            formatAudExact(totals.feesCents),
            formatAudExact(totals.netCents),
          ]}
        />
      )}
    </Panel>
  );
}
