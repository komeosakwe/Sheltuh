import type { EventCategory, FeePolicy } from "@/lib/types";

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

export interface TicketTypeInput {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  feePolicy: FeePolicy;
  quantityAvailable: number;
}

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

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}
