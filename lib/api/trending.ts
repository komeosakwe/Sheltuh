import { apiFetch, type GetToken } from "./client";
import type { PublicEvent } from "./public-events";

/**
 * Trending (docs/architecture.md, "Trending"): the public list behind the
 * home page's Trending section, and the admin curation that feeds it.
 */

/**
 * Why an event is trending. `going`: Who's Going is open and at least
 * TRENDING_GOING_THRESHOLD members are going (`goingCount` says how many).
 * `just-announced`: first approved within the last 72 hours. `popular`:
 * anything else. Never a raw view or favourite count.
 */
export type TrendingLabel = "going" | "just-announced" | "popular";

/** Members going at or above which a trending event is labelled "going" (with the count). */
export const TRENDING_GOING_THRESHOLD = 5;

export interface TrendingEvent {
  event: PublicEvent;
  label: TrendingLabel;
  /** Only with `label: "going"`, and then at least TRENDING_GOING_THRESHOLD. */
  goingCount?: number;
}

/** GET /api/events/trending. `items` is empty when fewer than 3 events qualify. */
export interface TrendingResponse {
  items: TrendingEvent[];
}

/** The trending events, best first (at most 24). Public; cached by the CDN for a few minutes. */
export function getTrendingEvents() {
  return apiFetch<TrendingResponse>("/events/trending");
}

/** One admin change to an event's curation, newest first. */
export interface CurationLogEntry {
  /** The admin's user id, or "system" if their account has since been deleted. */
  by: string;
  at: string;
  reason?: string;
  /** Only the fields that changed. */
  changes: {
    boost?: { old: number; new: number };
    excluded?: { old: boolean; new: boolean };
  };
}

/** GET / PUT /api/admin/events/{eventId}/curation (admin). */
export interface EventCuration {
  eventId: string;
  /** Multiplies the event's trending score: 0.5 to 2, default 1. */
  boost: number;
  /** Kept out of trending whatever its score. */
  excluded: boolean;
  /** When an admin last changed it; null if never. */
  updatedAt: string | null;
  /** The newest 20 changes. */
  log: CurationLogEntry[];
}

export interface SetEventCurationInput {
  /** 0.5 to 2, rounded to 2 decimal places. */
  boost: number;
  excluded: boolean;
  /** 1–500 characters, kept in the event's moderation log (admins only). */
  reason: string;
}

/** Bounds of an admin boost (inclusive). */
export const MIN_TRENDING_BOOST = 0.5;
export const MAX_TRENDING_BOOST = 2;

const curation = (eventId: string) => `/admin/events/${encodeURIComponent(eventId)}/curation`;

/** An event's curation (any status). ApiError 404 for an unknown event. */
export async function getEventCuration(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventCuration>(curation(eventId), { token });
}

/**
 * Sets an event's boost and exclusion, logged as `curated` with the reason
 * (nothing logged if nothing changes). Takes effect at the next trending
 * refresh, except an exclusion, which hides the event from the public list
 * straight away. ApiError 400 (fieldErrors boost / excluded / reason), 404.
 */
export async function setEventCuration(eventId: string, input: SetEventCurationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventCuration>(curation(eventId), { method: "PUT", body: input, token });
}
