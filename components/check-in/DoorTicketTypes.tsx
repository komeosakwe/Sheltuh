import { Panel } from "@/components/ui/Section";
import { formatCount } from "@/lib/analytics-format";
import type { CheckInSummary } from "@/lib/api/types";
import { checkedInPercent } from "@/lib/check-in/door-copy";
import { CountBar } from "./CheckInHeader";

function Rows({ types }: { types: CheckInSummary["byTicketType"] }) {
  if (types.length === 0) return <p className="text-sm text-muted">This event has no ticket types.</p>;
  return (
    // No rule under the last row: the next section's own top rule follows it.
    <dl className="[&>div:last-child]:border-b-0">
      {types.map((type) => (
        <div key={type.ticketTypeId} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-surface-border py-3">
          <dt className="min-w-0 text-sm break-words">{type.name}</dt>
          <dd className="text-right text-sm tabular-nums">
            {/* Short on screen so the name keeps its width at 768; said in full. */}
            {formatCount(type.checkedIn)} of {formatCount(type.ticketsSold)}
            <span className="sr-only"> checked</span> in
            <span className="block text-xs text-muted">Capacity {formatCount(type.capacity)}</span>
          </dd>
          <dd className="col-span-2 mt-2">
            {/* The bar is aria-hidden: this is what it shows. */}
            <span className="sr-only">{Math.round(checkedInPercent(type.checkedIn, type.ticketsSold))}% checked in</span>
            <CountBar value={type.checkedIn} total={type.ticketsSold} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** §5.A11: a disclosure on phones, an open panel from md. */
export default function DoorTicketTypes({ types }: { types: CheckInSummary["byTicketType"] }) {
  return (
    <>
      <details className="md:hidden">
        <summary className="eyebrow inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
          By ticket type
        </summary>
        <div className="mt-2">
          <Rows types={types} />
        </div>
      </details>
      <div className="hidden md:block">
        <Panel title="By ticket type" titleId="door-ticket-types">
          <Rows types={types} />
        </Panel>
      </div>
    </>
  );
}
