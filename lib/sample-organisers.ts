import { isApiConfigured } from "@/lib/api/client";
import { isUpcomingEvent } from "@/lib/data";
import { toMelbourneDateTimeInputParts } from "@/lib/format";
import type { OrganiserProfileDetails } from "@/lib/organiser-profile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The demo's organisers (no Supabase env): one per organiser name on the
 * sample events, so a sample event's "Organised by" links to a profile built
 * from the samples, as a live event's links to its organiser's. The sample
 * events themselves still carry no organiserId (lib/types.ts: that's how the
 * screens tell a demo event from a live one), so nothing else treats them as
 * live: the id is worked out from the name here.
 */

export interface SampleOrganiser {
  profile: OrganiserProfileDetails;
  /** Not ended yet, soonest first. */
  upcoming: SheltuhEvent[];
  /** Ended, most recent first. */
  past: SheltuhEvent[];
}

/** "Off-Kilter Theatre Co." -> "off-kilter-theatre-co", "Table & Tongue" -> "table-tongue". */
export function sampleOrganiserId(organiserName: string): string {
  return organiserName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Made-up websites for a couple of the organisers, on the reserved
 * `.example` domain, so the demo shows the Links section without pointing
 * anywhere real.
 */
const SAMPLE_WEBSITES: Readonly<Record<string, string>> = {
  "small-hours-theatre": "https://smallhourstheatre.example",
  "static-collective": "https://staticcollective.example",
};

function eventsByOrganiser(): Map<string, SheltuhEvent[]> {
  const groups = new Map<string, SheltuhEvent[]>();
  for (const event of sampleEvents) {
    const id = sampleOrganiserId(event.organiserName);
    groups.set(id, [...(groups.get(id) ?? []), event]);
  }
  return groups;
}

const SAMPLE_ORGANISER_EVENTS = eventsByOrganiser();

/** Whether `organiserId` is one of the demo's organisers. */
export function isSampleOrganiserId(organiserId: string): boolean {
  return SAMPLE_ORGANISER_EVENTS.has(organiserId);
}

const startTime = (event: SheltuhEvent) => Date.parse(event.startsAt);

/** "YYYY-MM" in Melbourne. */
function melbourneMonth(iso: string): string {
  return toMelbourneDateTimeInputParts(iso).date.slice(0, 7);
}

/**
 * A demo organiser's profile, built from their sample events the way the API
 * builds a live one: upcoming soonest first, past most recent first, events
 * hosted counting the past ones. Member since: the month of their first
 * event, or this month if that's still to come. No followers or video. Null
 * for an id that isn't one of the demo's organisers.
 */
export function getSampleOrganiser(organiserId: string, now: Date = new Date()): SampleOrganiser | null {
  const events = SAMPLE_ORGANISER_EVENTS.get(organiserId);
  if (!events || events.length === 0) return null;

  const upcoming = events.filter((event) => isUpcomingEvent(event, now)).sort((a, b) => startTime(a) - startTime(b));
  const past = events.filter((event) => !isUpcomingEvent(event, now)).sort((a, b) => startTime(b) - startTime(a));
  const first = events.reduce((earliest, event) => (startTime(event) < startTime(earliest) ? event : earliest));
  const firstMonth = melbourneMonth(first.startsAt);
  const thisMonth = melbourneMonth(now.toISOString());
  const categories = [...new Set(events.map((event) => event.category))];
  const suburbs = [...new Set(events.map((event) => event.suburb).filter(Boolean))];
  const displayName = first.organiserName;

  return {
    profile: {
      organiserId,
      displayName,
      description:
        `${displayName} is a fictional organiser, made up for this demo.` +
        (suburbs.length > 0 ? ` Find their events in ${suburbs.join(", ")}.` : ""),
      categories,
      websiteUrl: SAMPLE_WEBSITES[organiserId],
      socialLinks: {},
      memberSince: firstMonth < thisMonth ? firstMonth : thisMonth,
      featuredVideo: null,
      followerCount: null,
      eventsHosted: past.length,
    },
    upcoming,
    past,
  };
}

/**
 * Where an event's organiser name links: a live event's organiser profile,
 * or (demo only) the profile of the sample organiser with that name. Null
 * when there's no profile to show, so the name stays plain text.
 */
export function organiserProfileHref(event: Pick<SheltuhEvent, "organiserId" | "organiserName">): string | null {
  if (event.organiserId) return `/organisers/${encodeURIComponent(event.organiserId)}`;
  if (isApiConfigured) return null;
  const id = sampleOrganiserId(event.organiserName);
  return isSampleOrganiserId(id) ? `/organisers/${encodeURIComponent(id)}` : null;
}
