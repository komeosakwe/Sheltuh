"use client";

import MemberAvatar from "@/components/members/MemberAvatar";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import type { GetToken } from "@/lib/api/client";
import type { GoingAttendee } from "@/lib/api/types";

/** The collapsed preview shows at most this many faces (docs/design/mobile-redesign.md §6.4.2). */
export const FACES_MAX = 5;

/**
 * Who's Going's compact preview: up to five overlapping avatars, the
 * viewer's own (orange "you") first when they're going, then the first
 * people loaded. Only ever drawn from the names the API already sent this
 * viewer (or the demo's samples), never invented. A photo shows only for a
 * member with a visible profile who has one (`profileId` and `hasAvatar`),
 * fetched with the bearer token by MemberAvatar; everyone else is initials.
 * Decorative (aria-hidden): the count and the list carry the meaning (and,
 * when there's no count, the panel's screen-reader line: `facesSummary`).
 * They overlap by 4px, so two-letter initials stay readable.
 */
export default function GoingFaces({
  attendees,
  youName,
  getToken,
}: {
  attendees: GoingAttendee[];
  /** The viewer's display name when they're going. */
  youName?: string;
  /** Live, signed-in only: fetches profile photos. Without it, initials. */
  getToken?: GetToken;
}) {
  const others = attendees.slice(0, youName !== undefined ? FACES_MAX - 1 : FACES_MAX);
  if (others.length === 0 && youName === undefined) return null;
  return (
    <span aria-hidden="true" data-going-faces="" className="flex shrink-0">
      {youName !== undefined && (
        <span className="flex rounded-dot ring-2 ring-background">
          <InitialsAvatar name={youName} you />
        </span>
      )}
      {others.map((attendee, index) => (
        <span
          key={attendee.attendeeId}
          data-going-face=""
          className={`flex rounded-dot ring-2 ring-background ${index > 0 || youName !== undefined ? "-ml-1" : ""}`.trim()}
        >
          <MemberAvatar
            name={attendee.displayName}
            index={index}
            url={attendee.profileId && attendee.hasAvatar ? attendee.avatarThumbUrl : undefined}
            getToken={getToken}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * What the faces show, for screen readers, where no count is shown (fewer
 * than three going, so the faces are all a sighted viewer gets): the same
 * names, in the same order, that this viewer was already sent. Never a number.
 */
export function facesSummary(attendees: GoingAttendee[], youName?: string): string {
  const names = [
    ...(youName !== undefined ? ["you"] : []),
    ...attendees.slice(0, youName !== undefined ? FACES_MAX - 1 : FACES_MAX).map((a) => a.displayName),
  ];
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  // Names like "Mia T." already end the sentence.
  return `Going: ${list}${list.endsWith(".") ? "" : "."}`;
}
