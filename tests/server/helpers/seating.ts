import { adminApproveEvent } from "@/lib/server/handlers/admin";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { putSeatMap } from "@/lib/server/handlers/seating";
import type { EventRecord, SeatMapRecord } from "@/lib/server/types";
import type { TestApi } from "./api";
import { draftEvent, enablePayouts } from "./fixtures";

export interface GridRow {
  label: string;
  tier: string;
  seats: number;
  /** Seat numbers (1-based) that are blocked. */
  blocked?: number[];
  /** Seat numbers that are wheelchair spaces. */
  wheelchair?: number[];
}

/** One section ("Stalls") of straight rows; seat ids are row label + number ("A1"), map order row by row. */
export function gridTemplate(rows: GridRow[], options: { section?: string } = {}) {
  return {
    width: 1000,
    height: 1000,
    focus: { x: 500, y: 20 },
    stage: { label: "Stage", x: 300, y: 0, width: 400, height: 40 },
    sections: [
      {
        id: "stalls",
        label: options.section ?? "Stalls",
        rows: rows.map((row, r) => ({
          label: row.label,
          seats: Array.from({ length: row.seats }, (_, i) => ({
            id: `${row.label}${i + 1}`,
            label: String(i + 1),
            x: 100 + i * 28,
            y: 100 + r * 32,
            ticketTypeId: row.tier,
            ...(row.blocked?.includes(i + 1) ? { blocked: true } : {}),
            ...(row.wheelchair?.includes(i + 1) ? { kind: "wheelchair" } : {}),
          })),
        })),
      },
    ],
  };
}

/** Premium A$50 and standard A$30 seats (buyer pays the fee) and a GA standing tier. */
export const SEATED_TIERS = [
  { id: "prem", name: "Premium", priceCents: 5000, feePolicy: "buyer-pays", quantityAvailable: 1 },
  { id: "std", name: "Standard", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 1 },
  { id: "ga", name: "Standing", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 },
];

/** Row A: 4 premium; row B: 6 standard, B6 blocked. 9 sellable seats. */
export const DEFAULT_ROWS: GridRow[] = [
  { label: "A", tier: "prem", seats: 4 },
  { label: "B", tier: "std", seats: 6, blocked: [6] },
];

/** A draft with ticket types and a seat map, then (unless `publish: false`) approved and published. */
export async function seatedEvent(
  api: TestApi,
  organiser: { token: string; organiserId: string },
  admin: { token: string },
  options: { tiers?: unknown[]; rows?: GridRow[]; publish?: boolean; payouts?: boolean; overrides?: Record<string, unknown> } = {},
): Promise<{ event: EventRecord; map: SeatMapRecord }> {
  const draft = await draftEvent(api, organiser, { ticketTypes: options.tiers ?? SEATED_TIERS, ...options.overrides });
  const params = { eventId: draft.eventId };
  const saved = await api.call(putSeatMap, {
    token: organiser.token,
    params,
    method: "PUT",
    body: { template: gridTemplate(options.rows ?? DEFAULT_ROWS) },
  });
  if (saved.status !== 200) throw new Error(`putSeatMap failed: ${JSON.stringify(saved.body)}`);
  if (options.payouts !== false) await enablePayouts(api, organiser.organiserId);
  if (options.publish === false) return { event: draft, map: saved.body };
  await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
  const approved = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
  if (approved.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.body)}`);
  return { event: approved.body, map: saved.body };
}

/** Every seat's state, by id. */
export async function seatStates(api: TestApi, eventId: string) {
  const rows = await api.db.query<{ id: string; hold_order_id: string | null; sold_order_id: string | null; held: boolean }>(
    `select id, hold_order_id, sold_order_id, (hold_order_id is not null and hold_expires_at > now()) as held
       from public.event_seats where event_id = $1 order by position`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.sold_order_id ? `sold:${r.sold_order_id}` : r.held ? `held:${r.hold_order_id}` : "free"]));
}

export async function tierCounts(api: TestApi, eventId: string) {
  const rows = await api.db.query<{ id: string; quantity_available: number; quantity_sold: number; seated: boolean }>(
    `select id, quantity_available, quantity_sold, seated from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, { available: r.quantity_available, sold: r.quantity_sold, seated: r.seated }]));
}

export function orderIdFromUrl(url: string) {
  return new URL(url).searchParams.get("session_id")!;
}
