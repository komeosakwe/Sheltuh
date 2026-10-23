import type {
  AnalyticsDay,
  AnalyticsEventSummary,
  AnalyticsOverview,
  AnalyticsTotals,
  DateRange,
  EventAnalytics,
  MoneyTotals,
  OutboundClickStats,
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
 * began (or before retention), and `viewsUnreliable` true when the view cap
 * was reached on some day of it; either way there's no conversion rate.
 */
export function totals(
  sums: OrderSums,
  views: number,
  viewsComplete: boolean,
  viewsUnreliable = false,
): AnalyticsTotals {
  return {
    views,
    orders: sums.orders,
    ticketsSold: sums.ticketsSold,
    ...money(sums.grossCents, sums.feesCents),
    conversionRate: viewsComplete && !viewsUnreliable ? conversionRate(sums.orders, views) : null,
    viewsUnreliable,
  };
}

/**
 * Every day in `range`, zero-filled; views are null for days before
 * `viewsTrackedSince` (or all, if never). Days in `capDays` (the view cap was
 * reached) are flagged `viewsUnreliable`.
 */
export function dailySeries(
  range: DateRange,
  views: Map<string, number>,
  orders: Map<string, OrderSums>,
  viewsTrackedSince: string | null,
  capDays: ReadonlySet<string> = new Set(),
): AnalyticsDay[] {
  return eachDay(range).map((date) => {
    const o = orders.get(date) ?? NO_ORDERS;
    const counted = viewsTrackedSince !== null && date >= viewsTrackedSince;
    return {
      date,
      views: counted ? (views.get(date) ?? 0) : null,
      viewsUnreliable: capDays.has(date),
      orders: o.orders,
      ticketsSold: o.ticketsSold,
      ...money(o.grossCents, o.feesCents),
    };
  });
}

/** One day's outbound-click counter as SQL returns it. */
export interface OutboundDayRow {
  clicks: number;
  capReached: boolean;
}

/** Ticket-link clicks over `range`, zero-filled per day. `byDay` maps a Melbourne date to its counter. */
export function outboundStats(range: DateRange, byDay: Map<string, OutboundDayRow>): OutboundClickStats {
  const days = eachDay(range).map((date) => {
    const row = byDay.get(date);
    return { date, clicks: row?.clicks ?? 0, unreliable: row?.capReached ?? false };
  });
  return {
    total: days.reduce((sum, d) => sum + d.clicks, 0),
    unreliable: days.some((d) => d.unreliable),
    byDay: days,
  };
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

/** A row naming the days whose views hit the cap (lower bounds), if there are any. */
function unreliableNote(days: AnalyticsDay[]): CsvCell[][] {
  const capped = days.filter((d) => d.viewsUnreliable).map((d) => d.date);
  return capped.length > 0 ? [["Views incomplete (view cap reached) on", capped.join(" ")]] : [];
}
const moneyCells = (m: MoneyTotals): CsvCell[] => [{ cents: m.grossCents }, { cents: m.feesCents }, { cents: m.netCents }];

export function eventAnalyticsCsv(a: EventAnalytics): CsvCell[][] {
  const rows: CsvCell[][] = [...eventHeader(a.event, a.range, a.viewsTrackedSince), []];

  rows.push(["Date", "Views", "Orders", "Tickets sold", ...MONEY_HEADERS]);
  for (const d of a.byDay) rows.push([d.date, d.views, d.orders, d.ticketsSold, ...moneyCells(d)]);
  rows.push(["Total", a.totals.views, a.totals.orders, a.totals.ticketsSold, ...moneyCells(a.totals)]);
  rows.push(["Conversion (%)", pct(a.totals.conversionRate)]);
  rows.push(...unreliableNote(a.byDay));
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

  if (a.outboundClicks) rows.push([], ...outboundCsv(a.outboundClicks));

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

/** Ticket-link clicks (external ticketing): per day, the total and any days the click cap was reached. */
function outboundCsv(stats: OutboundClickStats): CsvCell[][] {
  const rows: CsvCell[][] = [["Date", "Ticket link clicks"]];
  for (const d of stats.byDay) rows.push([d.date, d.clicks]);
  rows.push(["Total", stats.total]);
  const capped = stats.byDay.filter((d) => d.unreliable).map((d) => d.date);
  if (capped.length > 0) rows.push(["Clicks incomplete (click cap reached) on", capped.join(" ")]);
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
  rows.push(...unreliableNote(o.byDay));
  if (o.eventsTruncated) rows.push(["Only the first 500 events are listed; the total covers them all."]);

  // External ticketing: clicks on each external event's ticket link (their sales happen elsewhere).
  if (o.outboundClicks) {
    rows.push([]);
    rows.push(["Event (tickets sold elsewhere)", "Ticket link clicks", ...(compare ? ["Previous ticket link clicks"] : [])]);
    for (const e of o.events) {
      if (!e.outboundClicks) continue;
      rows.push([e.title, e.outboundClicks.total, ...(compare ? [e.outboundClicks.previous?.total ?? 0] : [])]);
    }
    rows.push(["Total", o.outboundClicks.total, ...(compare ? [o.outboundClicks.previous?.total ?? 0] : [])]);
    const capped = o.outboundClicks.byDay.filter((d) => d.unreliable).map((d) => d.date);
    if (capped.length > 0) rows.push(["Clicks incomplete (click cap reached) on", capped.join(" ")]);
  }
  return rows;
}
