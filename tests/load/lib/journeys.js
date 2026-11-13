// What a visitor does, as the requests their browser makes: the HTML page,
// then the API calls that page's client code makes (lib/home-events.ts,
// components/LiveEventFeed.tsx, components/SceneMap.tsx, the event and
// organiser pages), then think time. Static assets (/_next/static, fonts,
// /public) are left out: Vercel's CDN serves them and they're not what this
// app could run out of.
import { check, sleep } from "k6";
import { jsonBody, sameOriginPath } from "./http.js";

const CATEGORIES = ["live-music", "art", "workshop", "pop-up", "theatre"];

/** Words people search for: some match seeded events, some match nothing (the slow case: no early stop). */
const SEARCH_TERMS = [
  "jazz",
  "ceramics",
  "fitzroy",
  "brunswick",
  "zine",
  "poetry",
  "workshop",
  "market",
  "film",
  "late night",
  "print",
  "dance",
  "load test",
  "comedy",
  "qzxv",
];

/** Where a visit starts, and where it goes next: [step, weight]. */
const LANDING = [
  ["home", 45],
  ["event", 25],
  ["events", 15],
  ["search", 10],
  ["map", 5],
];
const NEXT = [
  ["event", 40],
  ["events", 14],
  ["search", 14],
  ["organiser", 12],
  ["map", 8],
  ["home", 10],
  ["calendar", 2],
];

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function weighted(entries) {
  let total = 0;
  for (const e of entries) total += e[1];
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e[1];
    if (roll < 0) return e[0];
  }
  return entries[entries.length - 1][0];
}

function between(min, max) {
  return min + Math.random() * (max - min);
}

/** The fields the journeys use from a feed item. */
export function eventRef(item) {
  return {
    eventId: item.eventId,
    slug: item.slug,
    title: item.title,
    organiserId: item.organiserId,
    imageUrl: item.imageUrl || null,
    logoThumbUrl: item.organiserLogoThumbUrl || null,
    external: item.ticketingMode === "external",
    seatingVersion: item.seating && item.seating.version !== undefined ? item.seating.version : null,
  };
}

/**
 * Published, upcoming events from the feed (setup only): up to `maxPages`
 * pages of 50. These are what the journeys open, so a run needs a seeded
 * staging database (tests/load/README.md, "Seed the staging database").
 */
export function discoverEvents(client, maxPages) {
  const events = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const res = client.get(`/api/events?upcoming=1&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      rg: "setup",
      name: "discover events",
    });
    const body = jsonBody(res);
    if (res.status !== 200 || !body || !Array.isArray(body.items)) {
      throw new Error(`Couldn't read the event feed from ${client.target.baseUrl} (HTTP ${res.status}). Is the deployment up and in live mode?`);
    }
    for (const item of body.items) events.push(eventRef(item));
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return events;
}

/** Options a journey reads: think time (seconds) and whether view beacons are sent. */
export function journeyOptions(env, target) {
  const smoke = env.SMOKE === "1";
  return {
    thinkMin: Number(env.THINK_MIN || (smoke ? 0.5 : 3)),
    thinkMax: Number(env.THINK_MAX || (smoke ? 1 : 12)),
    beacons: !target.readOnly && env.VIEW_BEACONS !== "0",
    viewsPerVisit: smoke ? [1, 2] : [2, 5],
  };
}

function think(opts) {
  sleep(between(opts.thinkMin, opts.thinkMax));
}

/** The feed's JSON, checked: an items array. */
function feedItems(res, what) {
  const body = jsonBody(res);
  const ok = !!body && Array.isArray(body.items);
  const checks = {};
  checks[`${what}: has items[]`] = () => ok || res.status !== 200;
  check(res, checks);
  return ok ? body : { items: [] };
}

/** Image and logo requests for up to `n` cards, as the browser fetches them once the list renders. */
function cardImages(client, items, n) {
  const base = client.target.baseUrl;
  const reqs = [];
  for (const item of items.slice(0, n)) {
    const img = sameOriginPath(item.imageUrl, base);
    if (img) reqs.push({ path: img, spec: { rg: "image", name: "/api/events/[id]/image", cacheable: true, discardBody: true } });
    const logo = sameOriginPath(item.organiserLogoThumbUrl, base);
    if (logo) reqs.push({ path: logo, spec: { rg: "logo", name: "/api/organisers/[id]/logo", cacheable: true, discardBody: true } });
  }
  if (reqs.length > 0) client.batch(reqs);
}

/** An HTML page: rendered by a function (live mode reads the event or organiser for its metadata). */
const pageSpec = (name) => ({ rg: "page", name, discardBody: true });

export function home(client) {
  client.get("/", pageSpec("/"));
  const [feed] = client.batch([
    { path: "/api/events?upcoming=1&limit=40", spec: { rg: "feed", name: "feed: home", cacheable: true } },
    { path: "/api/events/trending", spec: { rg: "trending", name: "/api/events/trending", cacheable: true } },
    { path: "/api/events?upcoming=1&recent=only&limit=6", spec: { rg: "feed", name: "feed: recently on", cacheable: true } },
  ]);
  cardImages(client, feedItems(feed, "feed: home").items, 8);
}

export function eventsList(client) {
  const category = Math.random() < 0.25 ? pick(CATEGORIES) : null;
  client.get(category ? `/events?category=${category}` : "/events", pageSpec("/events"));
  // components/LiveEventFeed.tsx: category, then upcoming=1&recent=1 (lib/api/public-events.ts's order: one CDN key per filter).
  const query = `${category ? `category=${category}&` : ""}upcoming=1&recent=1`;
  const first = feedItems(client.get(`/api/events?${query}`, { rg: "feed", name: "feed: /events", cacheable: true }), "feed: /events");
  cardImages(client, first.items, 8);
  if (first.nextCursor && Math.random() < 0.3) {
    const more = client.get(`/api/events?${query}&cursor=${encodeURIComponent(first.nextCursor)}`, {
      rg: "feed",
      name: "feed: /events load more",
      cacheable: true,
    });
    cardImages(client, feedItems(more, "feed: /events load more").items, 6);
  }
}

export function search(client) {
  const term = pick(SEARCH_TERMS);
  const q = encodeURIComponent(term);
  client.get(`/search?q=${q}`, pageSpec("/search"));
  // A search is never shared at the CDN (private, no-store): every one reaches the database.
  const res = client.get(`/api/events?q=${q}&upcoming=1&recent=1`, { rg: "search", name: "feed: search" });
  cardImages(client, feedItems(res, "feed: search").items, 6);
}

export function map(client) {
  client.get("/map", pageSpec("/map"));
  // components/SceneMap.tsx: pages of 50 until the feed runs out (here at most 3).
  let cursor = null;
  for (let i = 0; i < 3; i++) {
    const res = client.get(`/api/events?upcoming=1&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      rg: "feed",
      name: "feed: map",
      cacheable: true,
    });
    cursor = feedItems(res, "feed: map").nextCursor;
    if (!cursor) break;
  }
}

/** The event page: HTML, then the event, its Who's Going count, its photo and the host's logo, then the view beacon. */
export function eventPage(client, ev, opts) {
  client.get(`/events/${ev.slug}`, pageSpec("/events/[slug]"));
  const reqs = [
    { path: `/api/events/slug/${ev.slug}`, spec: { rg: "event", name: "/api/events/slug/[slug]", cacheable: true } },
    ev.external
      ? { path: `/api/events/${ev.eventId}/external-going`, spec: { rg: "going", name: "/api/events/[id]/external-going", cacheable: true } }
      : { path: `/api/events/${ev.eventId}/going`, spec: { rg: "going", name: "/api/events/[id]/going" } },
  ];
  const img = sameOriginPath(ev.imageUrl, client.target.baseUrl);
  if (img) reqs.push({ path: img, spec: { rg: "image", name: "/api/events/[id]/image", cacheable: true, discardBody: true } });
  const logo = sameOriginPath(ev.logoThumbUrl, client.target.baseUrl);
  if (logo) reqs.push({ path: logo, spec: { rg: "logo", name: "/api/organisers/[id]/logo", cacheable: true, discardBody: true } });
  const [detail] = client.batch(reqs);
  const body = jsonBody(detail);
  check(detail, { "event: has the slug asked for": () => !!body && body.slug === ev.slug });

  if (opts.beacons) {
    // lib/api/analytics.ts recordEventView: same-origin JSON, 204 whether counted or not.
    client.post(`/api/events/${ev.eventId}/view`, {
      rg: "beacon",
      name: "/api/events/[id]/view",
      json: { source: Math.random() < 0.7 ? "direct" : "instagram" },
      expect: [204],
    });
  }
  if (ev.seatingVersion !== null && Math.random() < 0.3) seats(client, ev);
  return body;
}

/** The seat page's reads: the map at its version (immutable), then the 5-second availability bitmap. */
export function seats(client, ev) {
  client.batch([
    { path: `/api/events/${ev.eventId}/seat-map?v=${ev.seatingVersion}`, spec: { rg: "seats", name: "/api/events/[id]/seat-map", cacheable: true } },
    { path: `/api/events/${ev.eventId}/seat-availability`, spec: { rg: "seats", name: "/api/events/[id]/seat-availability", cacheable: true } },
  ]);
}

export function organiser(client, ev) {
  client.get(`/organisers/${ev.organiserId}`, pageSpec("/organisers/[id]"));
  const res = client.get(`/api/organisers/${ev.organiserId}/profile`, { rg: "profile", name: "/api/organisers/[id]/profile", cacheable: true });
  const body = jsonBody(res);
  check(res, { "profile: has upcomingEvents[]": () => !!body && Array.isArray(body.upcomingEvents) });
  const logo = body && sameOriginPath(body.logoUrl, client.target.baseUrl);
  if (logo) client.get(logo, { rg: "logo", name: "/api/organisers/[id]/logo", cacheable: true, discardBody: true });
  if (body && Array.isArray(body.upcomingEvents)) cardImages(client, body.upcomingEvents, 6);
}

export function calendar(client, ev) {
  const res = client.get(`/events/${ev.slug}/calendar.ics`, { rg: "calendar", name: "/events/[slug]/calendar.ics", cacheable: true });
  check(res, { "calendar: is iCalendar": (r) => r.status !== 200 || String(r.body).indexOf("BEGIN:VCALENDAR") !== -1 });
}

/**
 * One visit: a landing page, then a few more page views with think time in
 * between. `events` comes from discoverEvents (setup).
 */
export function browseVisit(client, events, opts) {
  const steps = [weighted(LANDING)];
  const [lo, hi] = opts.viewsPerVisit;
  const more = lo + Math.floor(Math.random() * (hi - lo + 1));
  for (let i = 0; i < more; i++) steps.push(weighted(NEXT));
  steps.forEach((step, i) => {
    if (i > 0) think(opts);
    const ev = pick(events);
    if (step === "home") home(client);
    else if (step === "events") eventsList(client);
    else if (step === "search") search(client);
    else if (step === "map") map(client);
    else if (step === "event") eventPage(client, ev, opts);
    else if (step === "organiser") organiser(client, ev);
    else if (step === "calendar") calendar(client, ev);
  });
  think(opts);
}
