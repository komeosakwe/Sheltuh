"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Field, fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import { formatAud } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { buildSeatLayout, layoutPreview, LAYOUT_SEAT_TARGET, SEAT_LAYOUTS, type SeatLayout } from "@/lib/seating/layouts";
import { flattenSeats, SEAT_SIZE, type SeatMapTemplate } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

const tierOption = (tier: TicketType) =>
  `${tier.name} · ${tier.priceCents === 0 ? "Free" : `${formatAud(getTicketBuyerTotalCents(tier))} incl. fee`}`;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;

/** A layout's schematic: its stage and rows (aisles left as gaps). Decorative: the card's text says it all. */
function LayoutSketch({ layout }: { layout: SeatLayout }) {
  const sketch = useMemo(() => layoutPreview(buildSeatLayout(layout.id, { seats: layout.sketchSeats, ticketTypeId: "sketch" })), [layout]);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${sketch.width} ${sketch.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-14 w-20 shrink-0 text-foreground lg:h-16 lg:w-full"
    >
      {sketch.stage && (
        <rect
          x={sketch.stage.x}
          y={sketch.stage.y}
          width={sketch.stage.width}
          height={sketch.stage.height}
          className="fill-surface stroke-foreground"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {sketch.runs.map((run, i) => (
        <path
          key={i}
          d={run.length === 1 ? `M${run[0].x} ${run[0].y}h0.01` : `M${run.map((p) => `${p.x} ${p.y}`).join("L")}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={SEAT_SIZE}
          strokeLinecap="square"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * "Start from a layout" (docs/design/seating.md §5.13): about how many seats,
 * which ticket type they use, then one tap on a layout card builds the whole
 * map (lib/seating/layouts.ts). The editor applies it (asking first when it
 * would replace seats already on the map). Works at every width: it's the
 * one way to make a map on a phone.
 */
export default function LayoutPicker({
  id,
  tiers,
  usableTierIds,
  defaultTierId,
  replacing,
  onPick,
}: {
  /** The section's id (the toolbar's Layouts button controls it). */
  id: string;
  tiers: TicketType[];
  /** Tiers a map may use (the first MAX_SEATED_TIERS). */
  usableTierIds: ReadonlySet<string>;
  defaultTierId: string;
  /** The map already has seats: picking replaces them (the editor asks first). */
  replacing: boolean;
  onPick: (layout: SeatLayout, template: SeatMapTemplate) => void;
}) {
  const uid = useId();
  const seatsRef = useRef<HTMLInputElement>(null);
  const [seatsText, setSeatsText] = useState(String(LAYOUT_SEAT_TARGET.initial));
  const [lastValid, setLastValid] = useState<number>(LAYOUT_SEAT_TARGET.initial);
  const [tierId, setTierId] = useState(defaultTierId);
  const [error, setError] = useState<string | null>(null);

  const seats = lastValid;
  const counts = useMemo(
    () =>
      new Map(
        SEAT_LAYOUTS.map((layout) => {
          const all = flattenSeats(buildSeatLayout(layout.id, { seats, ticketTypeId: "count" }));
          return [layout.id, { seats: all.length, wheelchair: all.filter((s) => s.kind === "wheelchair").length }];
        }),
      ),
    [seats],
  );

  function parse(text: string): number | null {
    if (!/^\s*\d[\d,\s]*$/.test(text)) return null;
    const n = Number(text.replace(/[,\s]/g, ""));
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  function pick(layout: SeatLayout) {
    const n = parse(seatsText);
    if (n === null) {
      setError(`Enter about how many seats, as a number (${LAYOUT_SEAT_TARGET.min} to ${LAYOUT_SEAT_TARGET.max.toLocaleString("en-AU")}).`);
      seatsRef.current?.focus();
      return;
    }
    if (!tierId || !usableTierIds.has(tierId)) {
      setError("Choose the price tier for these seats.");
      return;
    }
    onPick(layout, buildSeatLayout(layout.id, { seats: n, ticketTypeId: tierId }));
  }

  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  return (
    <section id={id} aria-labelledby={`${uid}-title`} className="border-b border-foreground px-4 py-4">
      <h2 id={`${uid}-title`} className="font-heading text-lg">
        Start from a layout
      </h2>
      <p className="mt-1 text-sm text-muted">
        Pick one to fill the map in one go, then change anything with the tools.
        {replacing ? " It replaces the seats on the map now (you can undo)." : ""}
      </p>
      {tiers.length === 0 ? (
        <div className="mt-3">
          <Notice>Add a ticket type to the event first: seats are sold as its tickets.</Notice>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Field label="About how many seats" htmlFor={`${uid}-seats`}>
              <input
                ref={seatsRef}
                id={`${uid}-seats`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={seatsText}
                onChange={(e) => {
                  setSeatsText(e.target.value);
                  setError(null);
                  const n = parse(e.target.value);
                  if (n !== null) setLastValid(n);
                }}
                aria-invalid={error && parse(seatsText) === null ? true : undefined}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                className={fieldClass}
              />
              <p id={hintId} className="text-xs text-muted">
                Each layout keeps to its own size: the cards show the seats you&rsquo;ll get.
              </p>
            </Field>
            <Field label="Price tier for these seats" htmlFor={`${uid}-tier`}>
              <select
                id={`${uid}-tier`}
                value={tierId}
                onChange={(e) => {
                  setTierId(e.target.value);
                  setError(null);
                }}
                className={fieldClass}
              >
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id} disabled={!usableTierIds.has(tier.id)}>
                    {tierOption(tier)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {error && (
            <p id={errorId} role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {SEAT_LAYOUTS.map((layout) => {
              const count = counts.get(layout.id);
              const nameId = `${uid}-${layout.id}-name`;
              const detailId = `${uid}-${layout.id}-detail`;
              return (
                <li key={layout.id} className="flex">
                  <button
                    type="button"
                    onClick={() => pick(layout)}
                    aria-labelledby={nameId}
                    aria-describedby={detailId}
                    className="flex min-h-11 w-full items-center gap-3 rounded-card border border-foreground bg-card p-3 text-left hover:bg-surface lg:flex-col lg:items-stretch"
                  >
                    <LayoutSketch layout={layout} />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span id={nameId} className="text-sm font-semibold break-words">
                        {layout.name}
                      </span>
                      <span id={detailId} className="flex flex-col gap-1">
                        <span className="text-sm text-muted">{layout.description}</span>
                        {count && (
                          <span className="meta text-foreground">
                            {plural(count.seats, "seat", "seats")}
                            {count.wheelchair > 0 ? ` · ${plural(count.wheelchair, "wheelchair space", "wheelchair spaces")}` : ""}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
