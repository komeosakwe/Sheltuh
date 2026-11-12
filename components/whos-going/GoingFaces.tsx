"use client";

import Link from "next/link";
import MemberAvatar from "@/components/members/MemberAvatar";
import { memberHref } from "./NameList";
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
 * A face whose member made their profile visible (`profileId`) links to that
 * profile (owner request), named "{name}'s profile"; every other face is
 * decorative (aria-hidden): the count and the list carry the meaning (and,
 * when there's no count, the panel's screen-reader line: `facesSummary`).
 * They overlap by 4px, so two-letter initials stay readable.
 */
export default function GoingFaces({
  attendees,
  youName,
  getToken,
  max = FACES_MAX,
  look = "panel",
}: {
  attendees: GoingAttendee[];
  /** The viewer's display name when they're going. */
  youName?: string;
  /** Live, signed-in only: fetches profile photos. Without it, initials. */
  getToken?: GetToken;
  /** At most this many faces, the viewer's own included (facesShown). */
  max?: number;
  /**
   * `panel`: the panel's 32px circles on the page. `card`: the Who's going card's 36px circles
   * with white rings on its dark ground (owner's mockup, 8 Nov 2026), overlapping by 2px. `row`: the event page's
   * Who's going row (the owner's event mock), the panel's 32px circles ringed in the row's cream.
   */
  look?: "panel" | "card" | "row";
}) {
  const others = attendees.slice(0, Math.max(0, youName !== undefined ? max - 1 : max));
  if (others.length === 0 && youName === undefined) return null;
  const card = look === "card";
  const ring = card ? "rounded-full ring-1 ring-paper" : look === "row" ? "rounded-full ring-2 ring-hover" : "rounded-full ring-2 ring-background";
  const focusRing = card ? "focus-visible:outline-paper" : "focus-visible:outline-foreground";
  return (
    <span data-going-faces="" className="flex shrink-0">
      {youName !== undefined && (
        <span aria-hidden="true" className={`flex ${ring}`}>
          <InitialsAvatar name={youName} you size={card ? "face" : "md"} />
        </span>
      )}
      {others.map((attendee, index) => {
        const overlap = index > 0 || youName !== undefined ? (card ? "-ml-0.5" : "-ml-1") : "";
        const className = `relative flex ${ring} ${overlap}`.trim();
        const avatar = (
          <MemberAvatar
            name={attendee.displayName}
            index={index}
            url={attendee.profileId && attendee.hasAvatar ? attendee.avatarThumbUrl : undefined}
            getToken={getToken}
            size={card ? "face" : "md"}
          />
        );
        return attendee.profileId ? (
          <Link
            key={attendee.attendeeId}
            href={memberHref(attendee.profileId)}
            data-going-face=""
            aria-label={`${attendee.displayName}’s profile`}
            className={`${className} hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 ${focusRing}`}
          >
            {avatar}
          </Link>
        ) : (
          <span key={attendee.attendeeId} data-going-face="" aria-hidden="true" className={className}>
            {avatar}
          </span>
        );
      })}
    </span>
  );
}

/** How many faces GoingFaces draws for these people (the viewer's own included), at most `max`. */
export function facesShown(attendees: GoingAttendee[], youName: string | undefined, max = FACES_MAX): number {
  const you = youName !== undefined ? 1 : 0;
  return Math.min(max, you + attendees.length);
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
