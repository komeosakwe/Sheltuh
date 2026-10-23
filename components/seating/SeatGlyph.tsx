import type { ReactNode } from "react";
import type { SeatTreatment } from "@/lib/seating/selection";
import { SEAT_SIZE, type SeatKind } from "@/lib/seating/template";

/** One seat's state on the buyer's map (docs/design/seating.md §5.3). Sold, held and blocked are one state. */
export type SeatState = "available" | "selected" | "unavailable";

/** Editor-only seat states (§5.13). */
export interface EditorSeatMarks {
  selected?: boolean;
  blocked?: boolean;
  invalid?: boolean;
}

const HALF = SEAT_SIZE / 2;
/** Content plates on patterned seats: 70% of the seat (§5.3). */
const PLATE = SEAT_SIZE * 0.7;

/** Pattern ids for one map's `<defs>` (unique per map, so two maps on a page don't clash). */
export interface PatternIds {
  dots: string;
  hatch: string;
  cross: string;
}

export function patternIdsFor(prefix: string): PatternIds {
  const clean = prefix.replace(/[^A-Za-z0-9_-]/g, "");
  return { dots: `${clean}-dots`, hatch: `${clean}-hatch`, cross: `${clean}-cross` };
}

/**
 * The tier patterns (§2.2): user-space patterns of black square marks on a
 * white base. They keep their colours in forced-colours mode so the tiers
 * stay tellable apart (§5.3).
 */
/**
 * The patterns in a zero-size SVG of their own, once per page: swatches and
 * maps elsewhere on the page reference them by id (not `display: none`,
 * which would stop the references from painting).
 */
export function SeatPatternDefs({ ids }: { ids: PatternIds }) {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none absolute">
      <SeatPatterns ids={ids} />
    </svg>
  );
}

export function SeatPatterns({ ids }: { ids: PatternIds }) {
  return (
    <defs style={{ forcedColorAdjust: "none" }}>
      <pattern id={ids.dots} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" className="fill-card" />
        <rect x="2.25" y="2.25" width="1.5" height="1.5" className="fill-foreground" />
      </pattern>
      <pattern id={ids.hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" className="fill-card" />
        <rect width="1.5" height="5" className="fill-foreground" />
      </pattern>
      <pattern id={ids.cross} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" className="fill-card" />
        <rect width="1.25" height="5" className="fill-foreground" />
        <rect width="5" height="1.25" className="fill-foreground" />
      </pattern>
    </defs>
  );
}

function treatmentFill(treatment: SeatTreatment, ids: PatternIds): { fill?: string; className: string } {
  switch (treatment) {
    case "outline":
      return { className: "fill-card" };
    case "solid":
      return { className: "fill-foreground" };
    default:
      return { fill: `url(#${ids[treatment]})`, className: "" };
  }
}

/** The check on a chosen seat: 60% of the seat, 2.5u stroke. */
function Check() {
  return (
    <path
      d="M-7 0.5 L-2.5 5 L7 -5"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="square"
      className="stroke-foreground"
      data-glyph="check"
    />
  );
}

/** The × on an unavailable seat: 50% of the seat. */
function Cross({ className }: { className: string }) {
  return <path d="M-6 -6 L6 6 M6 -6 L-6 6" fill="none" strokeWidth="1.75" className={className} data-glyph="cross" />;
}

/** The International Symbol of Access, simplified to strokes (65% of the seat). */
function WheelchairMark({ className }: { className: string }) {
  return (
    <g className={className} data-glyph="wheelchair">
      <rect x="-2.5" y="-8" width="3.5" height="3.5" rx="1" className="fill-current" />
      <path d="M-1 -3.5 V2 H4 L6.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M-4 -1 A5.5 5.5 0 1 0 3.5 6" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </g>
  );
}

function CompanionMark({ className }: { className: string }) {
  return (
    <text
      x="0"
      y="0"
      dominantBaseline="central"
      textAnchor="middle"
      fontSize="12"
      className={`font-mono font-medium ${className}`}
      data-glyph="companion"
    >
      C
    </text>
  );
}

export interface SeatGlyphProps {
  id: string;
  x: number;
  y: number;
  rotation: number;
  state: SeatState;
  treatment: SeatTreatment;
  kind: SeatKind;
  label: string;
  /** Rendered seat size in px (§2.1): which glyphs show. */
  seatPx: number;
  /** The view's scale, so seat numbers stay 12–14px on screen. */
  scale: number;
  patterns: PatternIds;
  editor?: EditorSeatMarks;
  /** The generator's preview (§5.13): a dashed outline, no fill. */
  ghost?: boolean;
}

/**
 * One seat (§5.3): a 24u rounded square (rx 4, never a circle), its tier's
 * pattern or a state fill, and a glyph once it's large enough: a check when
 * chosen, × when unavailable, the wheelchair pictogram or "C", else its
 * number from 32px. Only the square turns with the seat; the glyph stays
 * upright. Never focusable: the List view is the accessible route (§7).
 */
export default function SeatGlyph({
  id,
  x,
  y,
  rotation,
  state,
  treatment,
  kind,
  label,
  seatPx,
  scale,
  patterns,
  editor,
  ghost = false,
}: SeatGlyphProps) {
  if (ghost) {
    return (
      <rect
        x={x - HALF}
        y={y - HALF}
        width={SEAT_SIZE}
        height={SEAT_SIZE}
        rx="4"
        transform={rotation ? `rotate(${rotation} ${x} ${y})` : undefined}
        fill="none"
        strokeWidth="1"
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
        className="stroke-foreground"
        data-ghost=""
      />
    );
  }

  const blocked = editor?.blocked === true;
  const shownState: SeatState = blocked ? "unavailable" : state;
  const showGlyphs = seatPx >= 12;
  const baseStroke = seatPx >= 24 ? 1.5 : 1;

  let fill: { fill?: string; className: string };
  let strokeClass = "stroke-foreground";
  let strokeWidth = baseStroke;
  let dash: string | undefined;
  if (blocked) {
    fill = { className: "fill-surface" };
    strokeWidth = 1.5;
    dash = "3 3";
  } else if (shownState === "selected") {
    fill = { className: "fill-signal" };
    strokeWidth = 2;
  } else if (shownState === "unavailable") {
    fill = { className: "fill-surface" };
    strokeClass = "stroke-muted";
    strokeWidth = 1;
  } else {
    fill = treatmentFill(treatment, patterns);
  }
  if (editor?.invalid) {
    strokeClass = "stroke-danger";
    strokeWidth = 2;
  }

  // What's drawn inside, and in which colour (§5.3 content plates).
  const onSolid = shownState === "available" && !blocked && treatment === "solid";
  const needsPlate = shownState === "available" && !blocked && (treatment === "dots" || treatment === "hatch" || treatment === "cross");
  const inkClass = onSolid ? "text-background fill-background stroke-background" : "text-foreground fill-foreground stroke-foreground";
  const numberSize = (seatPx >= 40 ? 14 : 12) / scale;

  let content: ReactNode = null;
  if (editor?.invalid && showGlyphs) {
    content = (
      <>
        <rect x={-PLATE / 2} y={-PLATE / 2} width={PLATE} height={PLATE} rx="2" className="fill-card" />
        <text x="0" y="0" dominantBaseline="central" textAnchor="middle" fontSize="14" className="fill-danger font-semibold">
          !
        </text>
      </>
    );
  } else if (blocked && showGlyphs) {
    content = <Cross className="stroke-foreground" />;
  } else if (shownState === "selected" && showGlyphs) {
    content = <Check />;
  } else if (shownState === "unavailable" && showGlyphs) {
    content = <Cross className="stroke-muted" />;
  } else if (shownState === "available" && showGlyphs) {
    const glyph =
      kind === "wheelchair" ? (
        <WheelchairMark className={inkClass} />
      ) : kind === "companion" ? (
        <CompanionMark className={inkClass} />
      ) : seatPx >= 32 ? (
        <text
          x="0"
          y="0"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={numberSize}
          className={`font-mono font-medium tabular-nums ${inkClass}`}
        >
          {label}
        </text>
      ) : null;
    if (glyph) {
      content = (
        <>
          {needsPlate && <rect x={-PLATE / 2} y={-PLATE / 2} width={PLATE} height={PLATE} rx="2" className="fill-card" />}
          {glyph}
        </>
      );
    }
  }

  return (
    <g transform={`translate(${x} ${y})`} data-seat={id} data-state={blocked ? "blocked" : shownState} data-kind={kind}>
      {editor?.selected && (
        <rect
          x={-HALF - 3}
          y={-HALF - 3}
          width={SEAT_SIZE + 6}
          height={SEAT_SIZE + 6}
          rx="6"
          transform={rotation ? `rotate(${rotation})` : undefined}
          fill="none"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="stroke-signal"
          data-editor-selected=""
        />
      )}
      <rect
        x={-HALF}
        y={-HALF}
        width={SEAT_SIZE}
        height={SEAT_SIZE}
        rx="4"
        transform={rotation ? `rotate(${rotation})` : undefined}
        fill={fill.fill}
        strokeWidth={editor?.selected ? 2 : strokeWidth}
        strokeDasharray={dash}
        vectorEffect="non-scaling-stroke"
        className={`seat-shape ${fill.className} ${editor?.selected && !editor.invalid ? "stroke-foreground" : strokeClass}`}
      />
      {content}
    </g>
  );
}

/**
 * A standalone swatch of a seat (legend, list, tier rows): 16 or 20px, the
 * same drawing as on the map. Decorative: the words next to it carry the
 * meaning.
 */
export function SeatSwatch({
  treatment = "outline",
  state = "available",
  kind = "standard",
  size = 16,
  patterns,
}: {
  treatment?: SeatTreatment;
  state?: SeatState;
  kind?: SeatKind;
  size?: number;
  patterns: PatternIds;
}) {
  // Drawn as a 28u box at 1u = size/28 px; glyphs show as at s = 16–24.
  const scale = size / 28;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="-14 -14 28 28" className="shrink-0" focusable="false">
      <SeatGlyph
        id="swatch"
        x={0}
        y={0}
        rotation={0}
        state={state}
        treatment={treatment}
        kind={kind}
        label=""
        seatPx={state === "available" && kind === "standard" ? 8 : 16}
        scale={scale}
        patterns={patterns}
      />
    </svg>
  );
}
