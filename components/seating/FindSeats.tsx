"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { formatAud } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { MAX_SEATS_PER_ORDER } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

/** What a search found: the page applies it (replacing the selection) and says so. */
export type FindSeatsOutcome = "found" | "none" | "error";

/**
 * "Find seats" (docs/design/seating.md §5.9): how many (1–10, default 2) and
 * which price, then the best adjacent seats nearest the stage. Found: the
 * page replaces the selection (with Undo). None: an info notice here, the
 * selection unchanged.
 */
export default function FindSeats({
  tiers,
  onFind,
  layout = "stacked",
}: {
  tiers: TicketType[];
  onFind: (count: number, ticketTypeId: string | undefined) => FindSeatsOutcome;
  /** `columns`: the desktop panel's two selects side by side. */
  layout?: "stacked" | "columns";
}) {
  const id = useId();
  const [count, setCount] = useState(2);
  const [tierId, setTierId] = useState("");
  const [result, setResult] = useState<{ outcome: FindSeatsOutcome; message: string } | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const tier = tiers.find((t) => t.id === tierId);
    const outcome = onFind(count, tier?.id);
    if (outcome === "none") {
      setResult({
        outcome,
        message: `No ${count} ${count === 1 ? "seat" : "seats together"}${tier ? ` in ${tier.name}` : ""}. Try fewer seats or any price.`,
      });
    } else if (outcome === "error") {
      setResult({ outcome, message: "Couldn’t search just now. Try again." });
    } else {
      setResult(null);
    }
  }

  return (
    <form onSubmit={submit} className={`grid gap-4 ${layout === "columns" ? "grid-cols-2" : ""}`}>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-count`} className="eyebrow text-muted">
          How many
        </label>
        <select
          id={`${id}-count`}
          value={count}
          onChange={(event) => {
            setCount(Number(event.target.value));
            setResult(null);
          }}
          className="min-h-11 px-3 text-base sm:text-sm"
        >
          {Array.from({ length: MAX_SEATS_PER_ORDER }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-price`} className="eyebrow text-muted">
          Price
        </label>
        <select
          id={`${id}-price`}
          value={tierId}
          onChange={(event) => {
            setTierId(event.target.value);
            setResult(null);
          }}
          className="min-h-11 px-3 text-base sm:text-sm"
        >
          <option value="">Any price</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name} · {tier.priceCents === 0 ? "Free" : formatAud(getTicketBuyerTotalCents(tier))}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline" className={`min-h-11 w-full ${layout === "columns" ? "col-span-2" : ""}`}>
        Find seats
      </Button>
      {result && (
        <div className={layout === "columns" ? "col-span-2" : ""}>
          {result.outcome === "error" ? (
            <Notice tone="danger" role="alert">
              {result.message}
            </Notice>
          ) : (
            <Notice role="status">{result.message}</Notice>
          )}
        </div>
      )}
    </form>
  );
}
