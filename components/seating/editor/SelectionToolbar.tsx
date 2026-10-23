"use client";

import { useState, type KeyboardEvent } from "react";
import { filterChipClass } from "@/components/ui/FilterChip";
import type { SeatKind } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

export type Tri = boolean | "mixed";

const buttonClass = "btn btn-outline btn-sm min-h-10";

/**
 * The selected seats' actions (docs/design/seating.md §5.13): tier, the
 * wheelchair / companion / blocked toggles (aria-pressed, "mixed" when the
 * selection differs), relabel, align, nudge (4u; Shift 16u), clear and
 * delete. One tab stop: arrow keys move between the controls (roving
 * tabindex).
 */
export default function SelectionToolbar({
  count,
  tiers,
  usableTierIds,
  tier,
  wheelchair,
  companion,
  blocked,
  onTier,
  onKind,
  onBlocked,
  onRelabel,
  onAlign,
  onNudge,
  onClear,
  onDelete,
}: {
  count: number;
  tiers: TicketType[];
  usableTierIds: ReadonlySet<string>;
  /** The selection's tier, or "" when mixed. */
  tier: string;
  wheelchair: Tri;
  companion: Tri;
  blocked: Tri;
  onTier: (id: string) => void;
  onKind: (kind: SeatKind) => void;
  onBlocked: (blocked: boolean) => void;
  onRelabel: () => void;
  onAlign: () => void;
  onNudge: (dx: number, dy: number) => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const [active, setActive] = useState(0);
  const ITEMS = 12;
  const tab = (i: number) => ({ tabIndex: i === active ? 0 : -1, onFocus: () => setActive(i), "data-tb-item": i });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? ITEMS - 1 : (active + (event.key === "ArrowRight" ? 1 : -1) + ITEMS) % ITEMS;
    setActive(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-tb-item="${next}"]`)?.focus();
  }

  const toggle = (label: string, value: Tri, onPress: () => void, i: number) => (
    <button type="button" aria-pressed={value} onClick={onPress} className={filterChipClass(value === true, "sm:h-10")} {...tab(i)}>
      {value === "mixed" && <span aria-hidden="true">&ndash;</span>}
      {label}
    </button>
  );
  const nudge = (label: string, dx: number, dy: number, arrow: string, i: number) => (
    <button
      type="button"
      aria-label={`Nudge ${label}`}
      title={`Nudge ${label} (Shift: further)`}
      onClick={(event) => onNudge(dx * (event.shiftKey ? 4 : 1), dy * (event.shiftKey ? 4 : 1))}
      className={`${buttonClass} w-10 px-0`}
      {...tab(i)}
    >
      <span aria-hidden="true">{arrow}</span>
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Selected seats"
      onKeyDown={onKeyDown}
      className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-control border border-foreground bg-card px-3 py-2"
    >
      <p className="eyebrow">{count} selected</p>
      <label className="sr-only" htmlFor="seat-toolbar-tier">
        Tier
      </label>
      <select
        id="seat-toolbar-tier"
        value={tier}
        onChange={(event) => event.target.value && onTier(event.target.value)}
        className="min-h-10 px-2 text-sm"
        {...tab(0)}
      >
        {tier === "" && <option value="">Mixed tiers</option>}
        {tiers.map((t) => (
          <option key={t.id} value={t.id} disabled={!usableTierIds.has(t.id)}>
            {t.name}
          </option>
        ))}
      </select>
      {toggle("Wheelchair", wheelchair, () => onKind(wheelchair === true ? "standard" : "wheelchair"), 1)}
      {toggle("Companion", companion, () => onKind(companion === true ? "standard" : "companion"), 2)}
      {toggle("Blocked", blocked, () => onBlocked(blocked !== true), 3)}
      <button type="button" onClick={onRelabel} className={buttonClass} {...tab(4)}>
        Relabel&hellip;
      </button>
      <button type="button" onClick={onAlign} className={buttonClass} {...tab(5)}>
        Align row
      </button>
      {nudge("left", -4, 0, "←", 6)}
      {nudge("up", 0, -4, "↑", 7)}
      {nudge("right", 4, 0, "→", 8)}
      {nudge("down", 0, 4, "↓", 9)}
      <button type="button" onClick={onClear} className={buttonClass} {...tab(10)}>
        Clear
      </button>
      <button type="button" onClick={onDelete} className="btn btn-danger btn-sm min-h-10" {...tab(11)}>
        Delete
      </button>
    </div>
  );
}
