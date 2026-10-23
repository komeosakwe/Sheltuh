"use client";

import { filterChipClass } from "@/components/ui/FilterChip";
import type { FlatSeat, SeatMapSection, SeatMapTemplate } from "@/lib/seating/template";

/**
 * Section chips inside the map (docs/design/seating.md §5.6): one button per
 * section with what's left, pressing one fits the view to it. Only when the
 * map has two or more sections.
 */
export default function SectionChips({
  template,
  seats,
  isUnavailable,
  onShow,
}: {
  template: SeatMapTemplate;
  seats: FlatSeat[];
  isUnavailable: (seat: FlatSeat) => boolean;
  onShow: (section: SeatMapSection, available: number) => void;
}) {
  if (template.sections.length < 2) return null;
  const left = new Map<string, number>();
  for (const seat of seats) {
    if (!isUnavailable(seat)) left.set(seat.sectionId, (left.get(seat.sectionId) ?? 0) + 1);
  }
  return (
    <nav
      aria-label="Jump to a section"
      className="no-scrollbar absolute inset-x-0 top-2 flex gap-2 overflow-x-auto px-2 lg:top-3 lg:px-3"
    >
      {template.sections.map((section) => {
        const count = left.get(section.id) ?? 0;
        return (
          <button key={section.id} type="button" onClick={() => onShow(section, count)} className={filterChipClass(false)}>
            <span>{section.label}</span>
            <span className="meta text-muted">{count > 0 ? `${count} left` : "Sold out"}</span>
          </button>
        );
      })}
    </nav>
  );
}
