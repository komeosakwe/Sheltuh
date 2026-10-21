"use client";

import { useId, useMemo, useState, type Ref } from "react";
import { formatAud } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { seatRows, type SeatTreatment } from "@/lib/seating/selection";
import type { FlatSeat, SeatMapTemplate } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";
import { SeatSwatch, type PatternIds } from "./SeatGlyph";

/** "A$65.30 incl. booking fee", or "Free". */
export function seatPriceText(tier: TicketType | undefined): string {
  if (!tier) return "";
  return tier.priceCents === 0 ? "Free" : `${formatAud(getTicketBuyerTotalCents(tier))} incl. booking fee`;
}

/** A list checkbox's name (docs/design/seating.md §7): seat, kind, tier and all-inclusive price, or "unavailable". */
export function seatCheckboxName(seat: FlatSeat, tier: TicketType | undefined, unavailable: boolean): string {
  if (unavailable) return `Seat ${seat.seat}, unavailable`;
  const kind = seat.kind === "wheelchair" ? "wheelchair space, " : seat.kind === "companion" ? "companion seat, " : "";
  return `Seat ${seat.seat}, ${kind}${tier?.name ?? ""}, ${seatPriceText(tier)}`;
}

interface SeatListProps {
  template: SeatMapTemplate;
  seats: FlatSeat[];
  isUnavailable: (seat: FlatSeat) => boolean;
  selected: ReadonlySet<string>;
  tiers: TicketType[];
  treatments: Map<string, SeatTreatment>;
  patterns: PatternIds;
  interactive: boolean;
  onToggle: (seat: FlatSeat) => void;
  /** The first section's header button: the skip link moves focus here. */
  firstHeaderRef?: Ref<HTMLButtonElement>;
}

/**
 * The List view (docs/design/seating.md §7): the accessible equivalent of
 * the map. Sections (disclosures) → rows (fieldsets) → seats (native
 * checkboxes in 44px labels), with a price filter and "Available seats
 * only". At the 10-seat limit, unchecked boxes stay enabled: checking one is
 * refused by the page and announced, so nobody is stranded on a disabled
 * control.
 */
export default function SeatList({
  template,
  seats,
  isUnavailable,
  selected,
  tiers,
  treatments,
  patterns,
  interactive,
  onToggle,
  firstHeaderRef,
}: SeatListProps) {
  const idPrefix = useId();
  const tierById = useMemo(() => new Map(tiers.map((tier) => [tier.id, tier])), [tiers]);
  const [priceFilter, setPriceFilter] = useState("");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const open: Record<string, boolean> = {};
    template.sections.forEach((section, i) => {
      open[section.id] =
        template.sections.length <= 3 || i === 0 || seats.some((seat) => seat.sectionId === section.id && selected.has(seat.id));
    });
    return open;
  });

  const rowsBySection = useMemo(() => {
    const map = new Map<string, FlatSeat[][]>();
    for (const row of seatRows(seats)) {
      const list = map.get(row[0].sectionId) ?? [];
      list.push(row);
      map.set(row[0].sectionId, list);
    }
    return map;
  }, [seats]);

  const visible = (seat: FlatSeat) =>
    selected.has(seat.id) ||
    ((!availableOnly || !isUnavailable(seat)) && (priceFilter === "" || seat.ticketTypeId === priceFilter));

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-surface-border px-4 py-3 sm:px-8 lg:px-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-price`} className="eyebrow text-muted">
            Price
          </label>
          <select
            id={`${idPrefix}-price`}
            value={priceFilter}
            onChange={(event) => setPriceFilter(event.target.value)}
            className="min-h-11 px-3 text-base sm:text-sm"
          >
            <option value="">All prices</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name} · {tier.priceCents === 0 ? "Free" : formatAud(getTicketBuyerTotalCents(tier))}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} className="size-4" />
          Available seats only
        </label>
      </div>

      {template.sections.map((section, sectionIndex) => {
        const rows = rowsBySection.get(section.id) ?? [];
        const all = rows.flat();
        const free = all.filter((seat) => !isUnavailable(seat));
        const fromCents = free.length
          ? Math.min(...free.map((seat) => tierById.get(seat.ticketTypeId)).filter((t): t is TicketType => !!t).map(getTicketBuyerTotalCents))
          : null;
        const open = expanded[section.id] ?? false;
        const headingId = `${idPrefix}-s${sectionIndex}`;
        const panelId = `${idPrefix}-p${sectionIndex}`;
        const shownRows = rows.map((row) => row.filter(visible)).filter((row) => row.length > 0);
        return (
          <section key={section.id} aria-labelledby={headingId} className="px-4 sm:px-8 lg:px-4">
            {/* The heading holds the disclosure button (an accordion), so it stays a heading. */}
            <h2 id={headingId} className="border-t border-foreground">
              <button
                ref={sectionIndex === 0 ? firstHeaderRef : undefined}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setExpanded((prev) => ({ ...prev, [section.id]: !open }))}
                className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-heading text-xl leading-6">{section.label}</span>
                  <span className="meta text-muted">
                    {free.length} of {all.length} available
                    {fromCents !== null && ` · from ${fromCents === 0 ? "Free" : formatAud(fromCents)}`}
                  </span>
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className={`size-4 shrink-0 ${open ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                >
                  <path d="M3 6l5 5 5-5" />
                </svg>
              </button>
            </h2>
            <div id={panelId} hidden={!open} className="pb-3">
              {shownRows.length === 0 && <p className="py-3 text-sm text-muted">No seats here match.</p>}
              {shownRows.map((row) => {
                const rowTiers = new Set(row.map((seat) => seat.ticketTypeId));
                const oneTier = rowTiers.size === 1 ? tierById.get(row[0].ticketTypeId) : undefined;
                const groupName = row[0].row ? `${section.label}, Row ${row[0].row}` : section.label;
                return (
                  <fieldset key={`${section.id}-${row[0].row}`} aria-label={groupName} className="border-t border-surface-border py-3 first:border-t-0">
                    <legend className="eyebrow mb-2">
                      {row[0].row ? `Row ${row[0].row}` : "Seats"}
                      {oneTier && ` · ${oneTier.name} · ${seatPriceText(oneTier)}`}
                    </legend>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
                      {row.map((seat) => {
                        const unavailable = isUnavailable(seat) && !selected.has(seat.id);
                        const tier = tierById.get(seat.ticketTypeId);
                        return (
                          <label
                            key={seat.id}
                            className={`flex min-h-11 items-center gap-2 rounded-control border px-2 ${
                              unavailable
                                ? "border-surface-border bg-surface text-muted line-through"
                                : "border-foreground bg-card has-[:checked]:bg-signal"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(seat.id)}
                              disabled={unavailable || !interactive}
                              onChange={() => onToggle(seat)}
                              aria-label={seatCheckboxName(seat, tier, unavailable)}
                              className="size-4 shrink-0"
                              data-seat-id={seat.id}
                            />
                            <span aria-hidden="true" className="text-sm font-semibold tabular-nums">
                              {seat.seat}
                            </span>
                            {rowTiers.size > 1 && (
                              <SeatSwatch size={12} treatment={treatments.get(seat.ticketTypeId) ?? "outline"} patterns={patterns} />
                            )}
                            {seat.kind !== "standard" && (
                              <SeatSwatch size={12} kind={seat.kind} state="available" treatment="outline" patterns={patterns} />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
