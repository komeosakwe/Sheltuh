export type EventCategory = "live-music" | "art" | "workshop" | "pop-up" | "theatre";

export const EVENT_CATEGORIES: EventCategory[] = [
  "live-music",
  "art",
  "workshop",
  "pop-up",
  "theatre",
];

export type FeePolicy = "buyer-pays" | "organiser-absorbs";

export interface TicketTypeInput {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  feePolicy: FeePolicy;
  quantityAvailable: number;
}

export type OrganiserStatus = "pending" | "approved" | "rejected";

export interface OrganiserRecord {
  ownerUserId: string;
  organiserId: string;
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
  status: OrganiserStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EventStatus = "draft" | "pending_review" | "published" | "rejected";

export interface ModerationLogEntry {
  action: "submitted" | "approved" | "rejected" | "unpublished";
  by: string;
  at: string;
  reason?: string;
}

export interface EventRecord {
  organiserId: string;
  eventId: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  organiserName: string;
  ticketTypes: TicketTypeInput[];
  status: EventStatus;
  rejectionReason?: string;
  moderationLog: ModerationLogEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Fields the public feed is allowed to expose. Never spread a raw EventRecord into a public response. */
export type PublicEvent = Pick<
  EventRecord,
  | "eventId"
  | "slug"
  | "title"
  | "description"
  | "category"
  | "venueName"
  | "venueAddress"
  | "suburb"
  | "startsAt"
  | "endsAt"
  | "organiserName"
  | "ticketTypes"
>;

export function toPublicEvent(event: EventRecord): PublicEvent {
  return {
    eventId: event.eventId,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    ticketTypes: event.ticketTypes,
  };
}

/** Fields the applicant's own "my application" view is allowed to see — no reviewer identity. */
export type OwnOrganiserView = Omit<OrganiserRecord, "reviewedBy">;

export function toOwnOrganiserView(record: OrganiserRecord): OwnOrganiserView {
  const { reviewedBy: _reviewedBy, ...rest } = record;
  return rest;
}
