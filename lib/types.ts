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

export interface SheltuhEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  suburb: string;
  venueName: string;
  venueAddress: string;
  /** ISO 8601 datetime, wall-clock time in Australia/Melbourne. */
  startsAt: string;
  endsAt?: string;
  organiserName: string;
  poster: EventPoster;
  ticketTypes: TicketType[];
}
