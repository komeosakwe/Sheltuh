import type { PostHog } from "posthog-js";
import { INGEST_PATH, resolveAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics-config";
import { inAppBrowserName } from "@/lib/in-app-browser";
import { browserOptsOut, DENIED_PROPERTIES, sanitizePathname, sanitizePostHogEvent, type PrivacySignals } from "@/lib/analytics-privacy";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { parseTrackingRef } from "@/lib/tracking-ref";
import type { CustomerOrder } from "@/lib/api/types";
import type { EventCategory } from "@/lib/types";
import type { TicketingMode } from "@/lib/ticketing";

/**
 * Usage analytics (PostHog): active users, retention and funnels
 * (docs/architecture.md, "Usage analytics (PostHog)").
 *
 * OFF unless NEXT_PUBLIC_POSTHOG_KEY is set, and then only in live mode (demo
 * mode never reports) and only for a browser that hasn't asked not to be
 * tracked (Do Not Track, Global Privacy Control). Off, every function here
 * does nothing and posthog-js isn't even downloaded.
 *
 * Everything sent is chosen here: no autocapture, no session recording, no
 * heatmaps, no input values. People are identified only by their Supabase
 * user id (never an email, name or phone number), and the address of every
 * event is cleaned first (lib/analytics-privacy.ts). Properties are internal
 * slugs, uuids, counts and flags: never an order id, ticket code, token,
 * email or search words.
 */

/** Every custom event and exactly the properties it carries. */
export interface AnalyticsEvents {
  /** A new account confirmed (email code) or created from an invite link. */
  sign_up_completed: { signup_method: "email" | "invite" };
  signed_in: { signin_method: "password" | "oauth" };
  /** A live event page opened. `event_slug` is the public address of the event. */
  event_viewed: { event_slug: string; category: EventCategory; ticketing_mode: TicketingMode };
  /** Checkout began for an event (the order was created, or the confirmation link sent). */
  checkout_started: { event_slug: string; ticket_count: number; has_support: boolean; free: boolean };
  /**
   * The success page showed an order, once per order. `value_aud` is what the buyer paid in dollars
   * (all-inclusive: 0 for a free order), so PostHog can sum revenue by campaign. No order id.
   */
  order_completed: { event_slug?: string; value_aud: number; ticket_count: number; has_support: boolean; free: boolean };
  favourite_added: { event_slug: string };
  organiser_followed: { organiser_id: string };
  whos_going_opted_in: { event_slug: string };
  map_near_me_used: Record<string, never>;
  /** Only whether there were words and a place: never what they were. */
  search_performed: { has_query: boolean; has_location: boolean };
  organiser_event_created: Record<string, never>;
  organiser_event_published: { event_slug: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * order_completed's properties for a paid order the success page shows: the event's slug, what the
 * buyer paid in dollars, how many tickets, and whether it was free or carried Support Sheltüh. The
 * order's reference and id are never in it.
 */
export function orderCompletedProperties(
  order: Pick<CustomerOrder, "eventSlug" | "totalCents" | "supportCents" | "tickets">,
): AnalyticsEvents["order_completed"] {
  return {
    ...(order.eventSlug ? { event_slug: order.eventSlug } : {}),
    value_aud: order.totalCents / 100,
    ticket_count: order.tickets.length,
    has_support: (order.supportCents ?? 0) > 0,
    free: order.totalCents === 0,
  };
}

/** Whether this browser asks not to be tracked (Do Not Track or Global Privacy Control). False outside a browser. */
export function browserOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  const { doNotTrack } = window as Window & { doNotTrack?: unknown };
  return browserOptsOut(window.navigator as Navigator & PrivacySignals, doNotTrack);
}

/** The settings in effect, or null when analytics is off for this build (no key, or demo mode). */
export function analyticsConfig(): AnalyticsConfig | null {
  if (!isSupabaseConfigured) return null;
  return resolveAnalyticsConfig(process.env.NEXT_PUBLIC_POSTHOG_KEY, process.env.NEXT_PUBLIC_POSTHOG_HOST);
}

let client: Promise<PostHog> | null = null;

/**
 * Starts PostHog, once, in the browser. Called from instrumentation-client.ts
 * before the app hydrates. Does nothing when analytics is off or the browser
 * says Do Not Track / Global Privacy Control (then nothing is downloaded or
 * sent).
 */
export function initAnalytics(): void {
  if (client || typeof window === "undefined") return;
  const config = analyticsConfig();
  if (!config) return;
  if (browserOptedOut()) return;
  client = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(config.key, {
      // The first-party proxy (next.config.ts rewrites /ingest to PostHog), so ad blockers don't skew the numbers.
      api_host: INGEST_PATH,
      ui_host: config.uiHost,
      // People get a profile only once identified (by their user id, below).
      person_profiles: "identified_only",
      // We send pageviews and events ourselves, so nothing is captured that we didn't choose.
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_conversations: true,
      // No scripts are fetched from PostHog at run time (recorder, surveys, toolbar), and no feature-flag calls.
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      // Should anything ever be captured from the page, never the words or attributes in it.
      mask_all_text: true,
      mask_all_element_attributes: true,
      // No cookie: a random id in this browser's local storage.
      persistence: "localStorage",
      disable_capture_url_hashes: true,
      respect_dnt: true,
      property_denylist: [...DENIED_PROPERTIES],
      // The last stop before sending: /admin dropped, addresses cleaned (lib/analytics-privacy.ts).
      before_send: (event) => sanitizePostHogEvent(event),
    });
    // Where the visit came from, for marketing: PostHog itself keeps the utm_* parameters and the
    // referring domain. An in-app browser (Instagram, TikTok, Facebook…) is told apart here, as a
    // property of every event this visit (the user agent itself is not sent on).
    const inApp = inAppBrowserName(window.navigator.userAgent);
    if (inApp) posthog.register({ in_app_browser: inApp });
    return posthog;
  });
  // Analytics must never break the site: a blocked or failed load just leaves it off.
  client.catch(() => {
    client = null;
  });
}

/** Runs `action` once PostHog is up; nothing when analytics is off. A failure is dropped: it's only analytics. */
function withClient(action: (posthog: PostHog) => void): void {
  client
    ?.then(action)
    .catch(() => {});
}

/** One custom event, typed so a property can't be added without being listed in AnalyticsEvents. */
export function track<K extends AnalyticsEventName>(name: K, properties: AnalyticsEvents[K]): void {
  withClient((posthog) => posthog.capture(name, properties));
}

/** A page view, for a route change (the App Router doesn't reload the page). The address sent is the path only. */
export function trackPageview(pathname: string): void {
  withClient((posthog) => {
    // An organiser's tracking link (?ref=, lib/tracking-ref.ts): a short code, kept for this visit's events.
    const ref = parseTrackingRef(new URLSearchParams(window.location.search).get("ref"));
    if (ref) posthog.register_for_session({ tracking_ref: ref });
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${sanitizePathname(pathname)}`,
      $pathname: sanitizePathname(pathname),
    });
  });
}

// ---------------------------------------------------------------------------
// Once per thing
// ---------------------------------------------------------------------------

const ONCE_KEY = "sheltuh:analytics-once:v1";
const ONCE_LIMIT = 50;
const reportedThisPage = new Set<string>();

/** A short fingerprint of `key`, so what's remembered in the browser isn't an order reference itself. */
function fingerprint(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** Whether `key` was already claimed in this browser (and claims it). Falls back to this page load without storage. */
function claimOnce(key: string): boolean {
  const id = fingerprint(key);
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ONCE_KEY) ?? "[]");
    const seen = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    if (seen.includes(id)) return false;
    window.localStorage.setItem(ONCE_KEY, JSON.stringify([...seen, id].slice(-ONCE_LIMIT)));
    return true;
  } catch {
    if (reportedThisPage.has(id)) return false;
    reportedThisPage.add(id);
    return true;
  }
}

/**
 * `track`, but only the first time for `key` (an order, say) in this
 * browser: a reload or a return to the page doesn't count it again. Nothing is
 * claimed while analytics is off, so it can still be counted if it's turned on.
 */
export function trackOnce<K extends AnalyticsEventName>(key: string, name: K, properties: AnalyticsEvents[K]): void {
  if (!client) return;
  if (claimOnce(`${name}:${key}`)) track(name, properties);
}

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

/** Supabase user ids are uuids: anything else (an email, a name) is never sent as an identity. */
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Links this browser's events to the signed-in account, by its Supabase user id only. */
export function identifyUser(userId: string): void {
  if (!USER_ID.test(userId)) return;
  withClient((posthog) => {
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
  });
}

/** Signing out: the next person on this browser starts fresh. Does nothing if nobody was identified. */
export function resetIdentity(): void {
  withClient((posthog) => {
    if (posthog._isIdentified()) posthog.reset();
  });
}

/** For tests: forgets the started client and what was reported this page. */
export function resetAnalyticsForTests(): void {
  client = null;
  reportedThisPage.clear();
}
