import type { MemberProfile } from "@/lib/api/types";
import { isUpcomingEvent } from "@/lib/data";
import { sampleEvents } from "@/lib/sample-events";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleInstagramUrl, sampleMemberById } from "@/lib/sample-members";
import type { SheltuhEvent } from "@/lib/types";

/** The API's cap on a profile's events. */
const MAX_EVENTS = 24;

export interface SampleMemberProfile {
  profile: Omit<MemberProfile, "upcomingEvents">;
  /** The events they're on the Who's Going list of that haven't ended, soonest first. */
  events: SheltuhEvent[];
}

/**
 * A demo member's profile page (lib/sample-members.ts), as the API would
 * send it to another member: their name, bio and Instagram, no photo
 * (initials), and the open sample events whose Who's Going list has them
 * (never an external event's, which has no list). They can always be
 * messaged, in the demo conversation with them, whose id is theirs. Null for
 * an id that isn't a sample member.
 */
export function getSampleMemberProfile(profileId: string, now: Date = new Date()): SampleMemberProfile | null {
  const member = sampleMemberById(profileId);
  if (!member) return null;
  const events = sampleEvents
    .filter(
      (event) =>
        event.ticketingMode !== "external" &&
        isUpcomingEvent(event, now) &&
        getSampleGoing(event.id).attendees.some((attendee) => attendee.profileId === member.profileId),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, MAX_EVENTS);
  return {
    profile: {
      profileId: member.profileId,
      displayName: member.displayName,
      bio: member.bio,
      instagramHandle: member.instagramHandle,
      instagramUrl: member.instagramHandle ? sampleInstagramUrl(member.instagramHandle) : undefined,
      hasAvatar: false,
      isYou: false,
      canMessage: true,
      conversationId: member.profileId,
    },
    events,
  };
}
