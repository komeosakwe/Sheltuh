export type EventCategory =
  | "live-music"
  | "art"
  | "workshop"
  | "pop-up"
  | "theatre";

export const EVENT_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "live-music", label: "Live music" },
  { value: "art", label: "Art" },
  { value: "workshop", label: "Workshop" },
  { value: "pop-up", label: "Pop-up" },
  { value: "theatre", label: "Theatre" },
];

/**
 * Who absorbs the booking fee for a paid ticket. Free tickets never carry a fee,
 * regardless of this setting.
 */
export type FeePolicy = "buyer-pays" | "organiser-absorbs";

/** Decorative pattern rendered by components/EventArt.tsx. */
export type PosterPattern =
  | "burst"
  | "rings"
  | "grid"
  | "stripes"
  | "waves"
  | "confetti"
  | "curtain"
  | "halftone";

/** Local CSS/SVG poster artwork for an event — no remote image dependency. */
export interface EventPoster {
  pattern: PosterPattern;
  background: string;
  primary: string;
  secondary: string;
}

export interface TicketType {
  id: string;
  name: string;
  description?: string;
  /** Face value in integer cents. 0 means a free ticket. */
  priceCents: number;
  feePolicy: FeePolicy;
  quantityAvailable: number;
}

/** Decimal degrees, WGS84. */
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface SheltuhEvent {
  id: string;
  /**
   * Only present for live events — the checkout route's composite key
   * (/events/{organiserId}/{eventId}/checkout). Demo sample events have no
   * real backend to check out against, so this stays undefined for them.
   */
  organiserId?: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  suburb: string;
  venueName: string;
  venueAddress: string;
  /**
   * Approximate real-world position of the venue, when known. Not present
   * for every event — see lib/geo.ts's suburb-centroid fallback for events
   * (e.g. from the live API) that don't have a geocoded venue location yet.
   */
  coordinates?: Coordinates;
  /** ISO 8601 datetime, wall-clock time in Australia/Melbourne. */
  startsAt: string;
  endsAt?: string;
  organiserName: string;
  poster: EventPoster;
  ticketTypes: TicketType[];
  /**
   * Optional organiser-supplied context — shown on the details page only
   * when present. Never inferred or invented: the live API doesn't collect
   * these yet, so live events simply omit them rather than getting guessed
   * text. See lib/sample-events.ts for how the demo data fills them in.
   */
  audience?: string;
  whatToExpect?: string;
  ageRestriction?: string;
  accessibility?: string;
}
