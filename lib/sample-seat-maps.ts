/**
 * Demo-mode seat maps (no Supabase configured), keyed by sample event id.
 * Data only: the seat page reads the map from here instead of
 * GET /api/events/{id}/seat-map, and `unavailable` instead of the
 * availability poll. Same shapes as the API (lib/seating/template.ts).
 *
 * "Off-Kilter: A New Play" (lib/sample-events.ts, evt-off-kilter) is staged
 * in the round: four banks of three rows of five seats around a square
 * stage, 60 seats. Full price (off-kilter-full, 45 seats) everywhere except
 * the back row of the north, east and south banks, which are concession
 * (off-kilter-concession, 15 seats), matching the sample's capacities. One
 * wheelchair space and its companion seat are at the end of the west bank's
 * back row (the sample's accessibility note: one wheelchair-accessible
 * position).
 */
import { ROW_PITCH, SEAT_PITCH, type SeatKind, type SeatMapRow, type SeatMapSection, type SeatMapTemplate } from "./seating/template";

export interface SampleSeatMap {
  version: number;
  seatCount: number;
  template: SeatMapTemplate;
  /** Seat positions shown as unavailable in the demo (sold, held or blocked look the same). */
  unavailable: number[];
}

const SIZE = 560;
const CENTRE = SIZE / 2;
const STAGE = 200;
/** Distance from the stage edge to the front row's seat centres. */
const FRONT_GAP = 30;

type Side = "north" | "east" | "south" | "west";

const SIDES: { side: Side; label: string; rotation: number; concessionBackRow: boolean }[] = [
  { side: "north", label: "North", rotation: 0, concessionBackRow: true },
  { side: "east", label: "East", rotation: 90, concessionBackRow: true },
  { side: "south", label: "South", rotation: 180, concessionBackRow: true },
  { side: "west", label: "West", rotation: -90, concessionBackRow: false },
];

const ROWS = ["A", "B", "C"];
const SEATS_PER_ROW = 5;

/** A seat's centre: `depth` rows back from the stage, `across` seats along the bank (-2 … 2). */
function place(side: Side, depth: number, across: number): { x: number; y: number } {
  const out = STAGE / 2 + FRONT_GAP + depth * ROW_PITCH;
  const along = across * SEAT_PITCH;
  switch (side) {
    case "north":
      return { x: CENTRE + along, y: CENTRE - out };
    case "south":
      return { x: CENTRE - along, y: CENTRE + out };
    case "east":
      return { x: CENTRE + out, y: CENTRE + along };
    case "west":
      return { x: CENTRE - out, y: CENTRE - along };
  }
}

function bank(side: (typeof SIDES)[number]): SeatMapSection {
  const rows: SeatMapRow[] = ROWS.map((rowLabel, depth) => {
    const seats = Array.from({ length: SEATS_PER_ROW }, (_, i) => {
      const { x, y } = place(side.side, depth, i - (SEATS_PER_ROW - 1) / 2);
      const back = depth === ROWS.length - 1;
      const kind: SeatKind | undefined =
        side.side === "west" && back ? (i === 0 ? "wheelchair" : i === 1 ? "companion" : undefined) : undefined;
      return {
        id: `${side.side.charAt(0).toUpperCase()}-${rowLabel}${i + 1}`,
        label: String(i + 1),
        x,
        y,
        ticketTypeId: back && side.concessionBackRow ? "off-kilter-concession" : "off-kilter-full",
        ...(side.rotation !== 0 ? { rotation: side.rotation } : {}),
        ...(kind ? { kind } : {}),
      };
    });
    return { label: rowLabel, ends: [{ x: seats[0].x, y: seats[0].y }, { x: seats[seats.length - 1].x, y: seats[seats.length - 1].y }], seats };
  });
  // The bank's name, clear of its back row at any zoom (beside it for east and west: SeatMap anchors
  // it). Not further out: at the fitted view, NORTH would sit under the section chips, and WEST
  // would touch the canvas edge at 320px.
  const outer = place(side.side, ROWS.length + 0.25, 0);
  return { id: side.side, label: side.label, labelAnchor: outer, rows };
}

const offKilterTemplate: SeatMapTemplate = {
  width: SIZE,
  height: SIZE,
  focus: { x: CENTRE, y: CENTRE },
  stage: { label: "Stage", x: CENTRE - STAGE / 2, y: CENTRE - STAGE / 2, width: STAGE, height: STAGE },
  sections: SIDES.map(bank),
};

export const SAMPLE_SEAT_MAPS: Record<string, SampleSeatMap> = {
  "evt-off-kilter": {
    version: 1,
    seatCount: 60,
    template: offKilterTemplate,
    // A scattering of taken seats (positions in map order: North A1 is 0, West C5 is 59).
    unavailable: [2, 3, 7, 12, 13, 14, 16, 17, 22, 31, 32, 33, 40, 41, 47, 52, 53],
  },
};

/** The demo map for a sample event, if it's seated. */
export function sampleSeatMap(eventId: string): SampleSeatMap | undefined {
  return SAMPLE_SEAT_MAPS[eventId];
}
