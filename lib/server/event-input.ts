import type { EventCategory, TicketTypeInput } from "./types";
import {
  fail,
  requireCategory,
  requireMelbourneDateTime,
  requireString,
  requireTicketTypes,
} from "./validation";

export interface EventInput {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  ticketTypes: TicketTypeInput[];
}

interface RawEventBody {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  venueName?: unknown;
  venueAddress?: unknown;
  suburb?: unknown;
  start?: unknown;
  end?: unknown;
  ticketTypes?: unknown;
}

export function parseEventInput(body: RawEventBody): EventInput {
  const errors: Record<string, string> = {};

  const title = requireString(body.title, "title", errors, 150);
  const description = requireString(body.description, "description", errors, 4000);
  const category = requireCategory(body.category, "category", errors);
  const venueName = requireString(body.venueName, "venueName", errors, 150);
  const venueAddress = requireString(body.venueAddress, "venueAddress", errors, 250);
  const suburb = requireString(body.suburb, "suburb", errors, 100);
  const startsAt = requireMelbourneDateTime(body.start, "start", errors);
  const endsAt = requireMelbourneDateTime(body.end, "end", errors);
  const ticketTypes = requireTicketTypes(body.ticketTypes, "ticketTypes", errors);

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.end = "End time must be after the start time.";
  }

  if (Object.keys(errors).length > 0) fail(errors);

  return {
    title,
    description,
    category,
    venueName,
    venueAddress,
    suburb,
    startsAt: startsAt as string,
    endsAt: endsAt as string,
    ticketTypes,
  };
}
