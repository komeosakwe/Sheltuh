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
  stripeAccountId?: string;
  payoutsEnabled?: boolean;
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

export type OrderStatus = "pending" | "paid" | "failed" | "oversold_refund_required";

export interface OrderLineItem {
  ticketTypeId: string;
  ticketTypeName: string;
  unitPriceCents: number;
  feePolicy: FeePolicy;
  quantity: number;
}

export interface IssuedTicket {
  ticketCode: string;
  ticketTypeId: string;
  ticketTypeName: string;
}

export interface OrderRecord {
  orderId: string;
  organiserId: string;
  eventId: string;
  eventTitle: string;
  buyerEmail?: string;
  lineItems: OrderLineItem[];
  subtotalCents: number;
  buyerFeeCents: number;
  totalCents: number;
  applicationFeeCents: number;
  status: OrderStatus;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  tickets: IssuedTicket[];
  createdAt: string;
  updatedAt: string;
}
