import type { ReactNode } from "react";
import { describeBookingFee } from "@/lib/fees";
import { ValueOrNoData } from "./NoData";

export interface Stat {
  label: string;
  /** Formatted; null shows "—" (not counted). */
  value: string | null;
  /** "Up 12% vs previous 30 days": words carry the direction, never colour or arrows. */
  change?: string;
  /** Spans two columns (Net). */
  emphasis?: boolean;
}

/** Plain definitions, one tap away (§5.10). `keys` picks which apply to the page. */
const DEFINITIONS: Record<string, string> = {
  Views: "Times your event page was opened. We count page loads, not people.",
  Orders: "Completed orders, free and paid. Refunded, failed and unfinished orders aren't counted.",
  Conversion: "Orders divided by views.",
  "Tickets sold": "Tickets in those orders.",
  Gross: "What buyers paid, including any booking fees they paid.",
  Fees: `Sheltüh booking fees (${describeBookingFee()}), whether buyers paid them or you absorbed them.`,
  Net: "Gross minus fees. This is what Stripe pays out to you. Card processing costs come out of our share, not yours.",
  "Ticket link clicks":
    "Times the “Get tickets on …” link of an event sold on another site was opened. We count clicks, not people, and can’t see what happens on that site.",
};

/**
 * The headline numbers (§5.10): big Instrument Sans numerals on a hairline rule,
 * with the change in words underneath and the definitions in a disclosure.
 */
export default function StatGrid({ stats, footnote }: { stats: Stat[]; footnote?: ReactNode }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-foreground pt-5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={`flex flex-col gap-2 ${stat.emphasis ? "col-span-2" : ""}`.trim()}>
            <dt className="eyebrow text-muted">{stat.label}</dt>
            <dd className="font-heading text-[1.75rem] leading-8 font-extrabold tabular-nums sm:text-[2.5rem] sm:leading-10">
              <ValueOrNoData value={stat.value} />
            </dd>
            {stat.change && <dd className="text-xs text-muted">{stat.change}</dd>}
          </div>
        ))}
      </dl>
      {footnote && <div className="mt-4 text-xs text-muted">{footnote}</div>}
      <details className="mt-4 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
          How these are worked out
        </summary>
        <dl className="mt-2 flex max-w-2xl flex-col gap-3">
          {stats
            .filter((stat) => DEFINITIONS[stat.label])
            .map((stat) => (
              <div key={stat.label} className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_1fr]">
                <dt className="font-semibold">{stat.label}</dt>
                <dd className="text-muted">{DEFINITIONS[stat.label]}</dd>
              </div>
            ))}
        </dl>
      </details>
    </div>
  );
}
