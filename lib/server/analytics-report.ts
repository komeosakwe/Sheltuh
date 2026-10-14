import type {
  AnalyticsDay,
  AnalyticsEventSummary,
  AnalyticsOverview,
  AnalyticsTotals,
  DateRange,
  EventAnalytics,
  MoneyTotals,
  TicketTypeInput,
  TicketTypeSales,
} from "@/lib/api/types";
import type { FeePolicy } from "@/lib/types";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import { eachDay } from "./analytics-range";
import type { CsvCell } from "./csv";

/**
 * The arithmetic behind the analytics routes, kept free of SQL so it can be
 * unit-tested. Order-level money always comes from the orders' own priced
 * snapshots (total_cents, application_fee_cents: exactly what Stripe was
 * told); only the per-ticket-type split is re-derived, with lib/fees.ts.
 */

/** Paid-order sums as they come out of SQL. */
export interface OrderSums {
  orders: number;
  ticketsSold: number;
  grossCents: number;
  feesCents: number;
}

export const NO_ORDERS: OrderSums = { orders: 0, ticketsSold: 0, grossCents: 0, feesCents: 0 };

export function money(gross: number, fees: number): MoneyTotals {
  return { grossCents: gross, feesCents: fees, netCents: gross - fees };
}

export function conversionRate(orders: number, views: number): number | null {
  return views > 0 ? orders / views : null;
}

/**
 * `viewsComplete` is false when part of the period is before view counting
 * began (or before retention), and then there's no conversion rate.
 */
export function totals(sums: OrderSums, views: number, viewsComplete: boolean): AnalyticsTotals {
  return {
    views,
    orders: sums.orders,
    ticketsSold: sums.ticketsSold,
    ...money(sums.grossCents, sums.feesCents),
    conversionRate: viewsComplete ? conversionRate(sums.orders, views) : null,
  };
}

/** Every day in `range`, zero-filled; views are null for days before `viewsTrackedSince` (or all, if never). */
export function dailySeries(
  range: DateRange,
  views: Map<string, number>,
  orders: Map<string, OrderSums>,
  viewsTrackedSince: string | null,
): AnalyticsDay[] {
  return eachDay(range).map((date) => {
    const o = orders.get(date) ?? NO_ORDERS;
    const counted = viewsTrackedSince !== null && date >= viewsTrackedSince;
    return {
      date,
      views: counted ? (views.get(date) ?? 0) : null,
      orders: o.orders,
      ticketsSold: o.ticketsSold,
      ...money(o.grossCents, o.feesCents),
    };
  });
}

/** Whether every day of `range` had views counted. */
export function viewsComplete(range: DateRange, viewsTrackedSince: string | null): boolean {
  return viewsTrackedSince !== null && range.from >= viewsTrackedSince;
}

/**
 * Splits `total` into integer parts proportional to `weights` that add up to
 * exactly `total` (largest remainder). Equal weights and total give the
 * weights back unchanged. With no weight at all, it all goes to the first part.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w) => (T * BigInt(w)) / S);
  const remainders = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S }));
  let left = Number(T - parts.reduce((a, b) => a + b, BigInt(0)));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; left > 0; k = (k + 1) % remainders.length, left -= 1) parts[remainders[k].i] += BigInt(1);
  return parts.map(Number);
}

/** Paid line items grouped by (ticket type, unit price, fee policy), as SQL returns them. */
export interface LineGroup {
  ticketTypeId: string;
  ticketTypeName: string;
  unitPriceCents: number;
  feePolicy: FeePolicy;
  quantity: number;
}

/**
 * Sales per ticket type. Each group's gross and fees are worked out with
 * lib/fees.ts (the same functions checkout priced the orders with), then
 * reconciled to the orders' snapshot totals: if the fee rules were different
 * when some orders were placed, the snapshot difference is spread in
 * proportion, so the rows always add up to the event's totals exactly.
 */
export function ticketTypeSales(
  current: TicketTypeInput[],
  groups: LineGroup[],
  snapshot: OrderSums,
): TicketTypeSales[] {
  const computed = groups.map((g) => {
    const summary = calculateOrderSummary(g.unitPriceCents, g.quantity, g.feePolicy);
    return {
      group: g,
      face: summary.subtotalCents,
      gross: summary.totalCents,
      fees: calculateBookingFeeCents(g.unitPriceCents) * g.quantity,
    };
  });
  const gross = allocate(
    snapshot.grossCents,
    computed.map((c) => c.gross),
  );
  const fees = allocate(
    snapshot.feesCents,
    computed.map((c) => c.fees),
  );

  const rows = new Map<string, TicketTypeSales>();
  for (const t of current) {
    rows.set(t.id, {
      ticketTypeId: t.id,
      name: t.name,
      priceCents: t.priceCents,
      feePolicy: t.feePolicy,
      quantityAvailable: t.quantityAvailable,
      ticketsSold: 0,
      faceValueCents: 0,
      ...money(0, 0),
    });
  }
  computed.forEach((c, i) => {
    const row = rows.get(c.group.ticketTypeId) ?? {
      ticketTypeId: c.group.ticketTypeId,
      name: c.group.ticketTypeName,
      ticketsSold: 0,
      faceValueCents: 0,
      ...money(0, 0),
    };
    row.ticketsSold += c.group.quantity;
    row.faceValueCents += c.face;
    row.grossCents += gross[i];
    row.feesCents += fees[i];
    row.netCents = row.grossCents - row.feesCents;
    rows.set(c.group.ticketTypeId, row);
  });
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// CSV (no buyer data exists in these reports to begin with)
// ---------------------------------------------------------------------------

const pct = (rate: number | null): CsvCell => (rate === null ? null : Math.round(rate * 10000) / 100);

function eventHeader(event: AnalyticsEventSummary, range: DateRange, viewsTrackedSince: string | null): CsvCell[][] {
  return [
    ["Event", event.title],
    ["Status", event.status],
    ["From", range.from],
    ["To", range.to],
    ["Views counted since", viewsTrackedSince],
    ["Money", "AUD. Gross = what buyers paid; Fees = Sheltüh booking fees; Net = Gross − Fees (your payout)."],
  ];
}

const MONEY_HEADERS = ["Gross (AUD)", "Fees (AUD)", "Net (AUD)"];
const moneyCells = (m: MoneyTotals): CsvCell[] => [{ cents: m.grossCents }, { cents: m.feesCents }, { cents: m.netCents }];

export function eventAnalyticsCsv(a: EventAnalytics): CsvCell[][] {
  const rows: CsvCell[][] = [...eventHeader(a.event, a.range, a.viewsTrackedSince), []];

  rows.push(["Date", "Views", "Orders", "Tickets sold", ...MONEY_HEADERS]);
  for (const d of a.byDay) rows.push([d.date, d.views, d.orders, d.ticketsSold, ...moneyCells(d)]);
  rows.push(["Total", a.totals.views, a.totals.orders, a.totals.ticketsSold, ...moneyCells(a.totals)]);
  rows.push(["Conversion (%)", pct(a.totals.conversionRate)]);
  rows.push([]);

  rows.push(["Source", "Views"]);
  for (const s of a.bySource) rows.push([s.source, s.views]);
  rows.push([]);

  rows.push(["Ticket type", "Tickets sold", "Face value (AUD)", ...MONEY_HEADERS]);
  for (const t of a.byTicketType) {
    rows.push([t.name, t.ticketsSold, { cents: t.faceValueCents }, ...moneyCells(t)]);
  }
  rows.push([]);

  rows.push(["Tracking link", "Code", "Views", "Orders", "Tickets sold", ...MONEY_HEADERS, "Conversion (%)"]);
  for (const l of a.trackingLinks) {
    rows.push([l.label ?? "(deleted link)", l.code, l.views, l.orders, l.ticketsSold, ...moneyCells(l), pct(l.conversionRate)]);
  }

  if (a.previous) {
    rows.push([]);
    rows.push(["Previous period", `${a.previous.range.from} to ${a.previous.range.to}`]);
    rows.push(["Date", "Views", "Orders", "Tickets sold", ...MONEY_HEADERS]);
    for (const d of a.previous.byDay) rows.push([d.date, d.views, d.orders, d.ticketsSold, ...moneyCells(d)]);
    const p = a.previous.totals;
    rows.push(["Total", p.views, p.orders, p.ticketsSold, ...moneyCells(p)]);
  }
  return rows;
}

export function overviewCsv(o: AnalyticsOverview): CsvCell[][] {
  const compare = Boolean(o.previous);
  const rows: CsvCell[][] = [
    ["From", o.range.from],
    ["To", o.range.to],
    ...(o.previous ? [["Previous period", `${o.previous.range.from} to ${o.previous.range.to}`]] : []),
    ["Views counted since", o.viewsTrackedSince],
    ["Money", "AUD. Gross = what buyers paid; Fees = Sheltüh booking fees; Net = Gross − Fees (your payout)."],
    [],
  ];
  const line = (t: AnalyticsTotals): CsvCell[] => [t.views, t.orders, t.ticketsSold, ...moneyCells(t), pct(t.conversionRate)];
  const headers = ["Views", "Orders", "Tickets sold", ...MONEY_HEADERS, "Conversion (%)"];
  rows.push([
    "Event",
    "Starts",
    "Status",
    ...headers,
    ...(compare ? headers.map((h) => `Previous ${h.charAt(0).toLowerCase()}${h.slice(1)}`) : []),
  ]);
  for (const e of o.events) {
    rows.push([e.title, e.startsAt, e.status, ...line(e.totals), ...(compare && e.previous ? line(e.previous) : [])]);
  }
  rows.push(["Total", null, null, ...line(o.totals), ...(o.previous ? line(o.previous.totals) : [])]);
  if (o.eventsTruncated) rows.push(["Only the first 500 events are listed; the total covers them all."]);
  return rows;
}
