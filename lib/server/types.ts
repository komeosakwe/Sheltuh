/**
 * Server-side view of the API's shapes. The response types are shared with
 * the frontend (lib/api/types.ts) so the two can't drift apart.
 */
import type { EventCategory } from "@/lib/types";

export type { EventCategory, FeePolicy } from "@/lib/types";
export type {
  AdminEmailJob,
  AdminOrganiserRecord,
  OrganiserEditChange,
  OrganiserEditEntry,
  OrganiserEditField,
  SuspendOrganiserResult,
  AdminReport,
  EmailJobStatus,
  BlockRecord,
  CheckoutResult,
  ConfirmFreeOrderResult,
  ConversationStatus,
  ConversationSummary,
  CustomerOrder,
  CustomerOrderLookup,
  EventRecord,
  EventStatus,
  GoingAttendee,
  GoingSummary,
  IssuedTicket,
  MessagePage,
  MessageRecord,
  ModerationLogEntry,
  MyGoingStatus,
  OrderLineItem,
  OrderRecord,
  OrderStatus,
  OrganiserRecord,
  OrganiserSocialLinks,
  OrganiserStatus,
  ProfileInput,
  ProfileRecord,
  PublicOrganiserProfile,
  ReportReason,
  ReportReceipt,
  ReportStatus,
  TicketTypeInput,
  UnreadCount,
} from "@/lib/api/types";
export type { PublicEvent } from "@/lib/api/public-events";

export const EVENT_CATEGORIES: EventCategory[] = ["live-music", "art", "workshop", "pop-up", "theatre"];
