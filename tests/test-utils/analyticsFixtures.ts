import type {
  AnalyticsDay,
  AnalyticsOverview,
  AnalyticsTotals,
  EventAnalytics,
  TrackingLink,
} from "@/lib/api/types";
import { addDays } from "@/lib/analytics-format";

export function totals(overrides: Partial<AnalyticsTotals> = {}): AnalyticsTotals {
  return {
    views: 1204,
    orders: 41,
    ticketsSold: 60,
    grossCents: 120450,
    feesCents: 8450,
    netCents: 112000,
    conversionRate: 41 / 1204,
    ...overrides,
  };
}

export function days(from: string, n: number, make: (i: number) => Partial<AnalyticsDay> = () => ({})): AnalyticsDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: addDays(from, i),
    views: 10,
    orders: 1,
    ticketsSold: 2,
    grossCents: 1000,
    feesCents: 100,
    netCents: 900,
    ...make(i),
  }));
}

export function overview(overrides: Partial<AnalyticsOverview> = {}): AnalyticsOverview {
  return {
    range: { from: "2026-09-16", to: "2026-10-15" },
    viewsTrackedSince: "2026-01-01",
    totals: totals(),
    byDay: days("2026-09-16", 30),
    events: [
      {
        eventId: "evt-1",
        title: "Night Market",
        slug: "night-market",
        status: "published",
        startsAt: "2026-10-23T09:00:00.000Z",
        totals: totals(),
      },
    ],
    eventsTruncated: false,
    ...overrides,
  };
}

export function eventReport(overrides: Partial<EventAnalytics> = {}): EventAnalytics {
  return {
    event: {
      eventId: "evt-1",
      title: "Night Market",
      slug: "night-market",
      status: "published",
      startsAt: "2026-10-23T09:00:00.000Z",
      endsAt: "2026-10-23T12:00:00.000Z",
      venueName: "The Shed",
      everPublished: true,
    },
    range: { from: "2026-10-01", to: "2026-10-14" },
    viewsTrackedSince: "2026-01-01",
    totals: totals(),
    byDay: days("2026-10-01", 14),
    bySource: [
      { source: "direct", views: 100 },
      { source: "search", views: 50 },
      { source: "instagram", views: 600 },
      { source: "facebook", views: 200 },
      { source: "x", views: 0 },
      { source: "tiktok", views: 4 },
      { source: "email", views: 50 },
      { source: "eventbrite", views: 0 },
      { source: "other", views: 0 },
      { source: "tracking", views: 200 },
    ],
    byTicketType: [
      {
        ticketTypeId: "t1",
        name: "General",
        priceCents: 2500,
        feePolicy: "buyer-pays",
        quantityAvailable: 100,
        ticketsSold: 42,
        faceValueCents: 105000,
        grossCents: 113400,
        feesCents: 8400,
        netCents: 105000,
      },
      {
        ticketTypeId: "t2",
        name: "Free list",
        priceCents: 0,
        feePolicy: "buyer-pays",
        quantityAvailable: 18,
        ticketsSold: 18,
        faceValueCents: 0,
        grossCents: 0,
        feesCents: 0,
        netCents: 0,
      },
    ],
    trackingLinks: [
      {
        code: "ab3def7h",
        linkId: "l1",
        label: "Instagram bio",
        views: 200,
        orders: 10,
        ticketsSold: 12,
        grossCents: 30000,
        feesCents: 2000,
        netCents: 28000,
        conversionRate: 0.05,
      },
      {
        code: "zz9yx8wv",
        views: 5,
        orders: 0,
        ticketsSold: 0,
        grossCents: 0,
        feesCents: 0,
        netCents: 0,
        conversionRate: 0,
      },
    ],
    ...overrides,
  };
}

export function link(id: string, label: string, overrides: Partial<TrackingLink> = {}): TrackingLink {
  return {
    linkId: id,
    code: `code${id}`.slice(0, 8),
    label,
    url: `https://sheltuh.com.au/events/night-market?ref=${id}`,
    createdAt: "2026-10-01T00:00:00.000Z",
    views: 12,
    orders: 3,
    ticketsSold: 4,
    grossCents: 12050,
    ...overrides,
  };
}

/** jsdom has no matchMedia; the charts ask whether this is a phone. */
export function stubMatchMedia(phone = false) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
