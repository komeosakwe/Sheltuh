"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatAud } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import type { SeatTreatment } from "@/lib/seating/selection";
import type { TicketType } from "@/lib/types";
import { SeatSwatch, type PatternIds } from "./SeatGlyph";

interface LegendProps {
  tiers: TicketType[];
  treatments: Map<string, SeatTreatment>;
  patterns: PatternIds;
  /** A mixed event: say what general admission is. */
  mixed: boolean;
}

const priceOf = (tier: TicketType) => (tier.priceCents === 0 ? "Free" : formatAud(getTicketBuyerTotalCents(tier)));

/**
 * The full legend (docs/design/seating.md §5.5): each seated tier's pattern,
 * name, all-inclusive price, then every seat state.
 */
export function SeatLegendFull({ tiers, treatments, patterns, mixed }: LegendProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2 id={headingId} className="eyebrow text-muted">
        Prices and key
      </h2>
      <dl className="mt-2 flex flex-col">
        {tiers.map((tier) => {
          return (
            <div key={tier.id} className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-x-3 border-t border-surface-border py-2">
              <SeatSwatch size={20} treatment={treatments.get(tier.id) ?? "outline"} patterns={patterns} />
              <dt className="min-w-0">
                <span className="block text-base leading-snug font-semibold">{tier.name}</span>
              </dt>
              <dd className="text-base leading-6 font-semibold tabular-nums">{priceOf(tier)}</dd>
            </div>
          );
        })}
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 border-t border-surface-border py-2">
          <SeatSwatch size={20} state="selected" patterns={patterns} />
          <dt className="text-sm">Your seats</dt>
        </div>
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 border-t border-surface-border py-2">
          <SeatSwatch size={20} state="unavailable" patterns={patterns} />
          <dt className="text-sm">Unavailable</dt>
        </div>
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 border-t border-surface-border py-2">
          <SeatSwatch size={20} kind="wheelchair" patterns={patterns} />
          <dt className="text-sm">Wheelchair space</dt>
        </div>
        <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 border-t border-surface-border py-2">
          <SeatSwatch size={20} kind="companion" patterns={patterns} />
          <dt className="text-sm">Companion seat</dt>
        </div>
        {mixed && (
          <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 border-t border-surface-border py-2">
            <span aria-hidden="true" className="size-5 rounded-badge border border-foreground" />
            <dt className="text-sm">General admission: standing, no seat</dt>
          </div>
        )}
      </dl>
      <p className="mt-1 text-xs text-muted">Unavailable includes sold, held and reserved seats.</p>
    </section>
  );
}

/**
 * The phone legend strip (§5.5): each tier's swatch, price and name in a
 * scrolling row, then a Key button opening the full legend in a popover.
 * Escape closes it and returns focus to the button.
 */
export function SeatLegendStrip(props: LegendProps) {
  const { tiers, treatments, patterns } = props;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="relative flex items-center gap-3 border-b border-surface-border pr-4 sm:pr-8">
      {/* The prices scroll; Key stays put beside them, always reachable. */}
      <div className="no-scrollbar flex min-h-11 min-w-0 flex-1 items-center gap-4 overflow-x-auto pl-4 sm:pl-8">
        {tiers.map((tier) => (
          <span key={tier.id} className="inline-flex shrink-0 items-center gap-2 text-sm">
            <SeatSwatch size={16} treatment={treatments.get(tier.id) ?? "outline"} patterns={patterns} />
            <span className="font-semibold tabular-nums">{priceOf(tier)}</span>
            <span>{tier.name}</span>
          </span>
        ))}
        <span className="meta shrink-0 text-muted">Incl. booking fee</span>
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 shrink-0 text-sm font-semibold underline underline-offset-4"
      >
        Key
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        hidden={!open}
        className="seat-popover absolute top-full right-4 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-control border border-foreground bg-card p-4"
      >
        {open && <SeatLegendFull {...props} />}
      </div>
    </div>
  );
}
