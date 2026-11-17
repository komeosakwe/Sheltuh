import Link from "next/link";
import type { Ref } from "react";
import ShareButton from "@/components/ShareButton";
import FollowButton from "@/components/organisers/FollowButton";
import OrganiserCover from "@/components/organisers/OrganiserCover";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import OwnLogoPrompt from "@/components/organisers/OwnLogoPrompt";
import VideoFacade from "@/components/organisers/VideoFacade";
import BackLink from "@/components/ui/BackLink";
import CategoryTag from "@/components/ui/CategoryTag";
import EventCard from "@/components/ui/EventCard";
import { HOME_GRID } from "@/components/ui/grids";
import SectionHead from "@/components/ui/SectionHead";
import Strap from "@/components/ui/Strap";
import { organiserTagLabel, tagsForEventCategories } from "@/lib/api/organiser-tags";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventZone, formatDayWithYear } from "@/lib/format";
import {
  formatMemberSince,
  organiserProfilePath,
  reportOrganiserHref,
  type OrganiserProfileDetails,
} from "@/lib/organiser-profile";
import { eventPlaceName } from "@/lib/place";
import { siteOrigin } from "@/lib/share-metadata";
import type { SheltuhEvent } from "@/lib/types";

const countFormatter = new Intl.NumberFormat("en-AU");

/** The most past events listed (the API sends at most this many; the demo's are cut to match). */
export const PAST_EVENTS_SHOWN = 12;

/** The gap above each section below the header (Round 2 §1.4): 40 / 48 / 64. */
const SECTION_GAP = "mt-10 md:mt-12 lg:mt-16";

/** A fact's number and its word: "1 event", "1,240 followers". */
function fact(n: number, one: string, many: string) {
  return { number: countFormatter.format(n), label: n === 1 ? one : many };
}

/**
 * An approved organiser's public profile (docs/design/organiser-profile.md):
 * their cover across the top when they have one, with their logo over its
 * bottom-left corner; then who they are (name, a line of facts: events,
 * followers once there are 10, member since), Follow and Share, their
 * categories, bio and links; then their events: `upcoming` (soonest first)
 * as cards, their featured video, `past` (most recent first) as a list of
 * up to 12, and a link to report them. The events come already in the
 * screens' shape (a live profile's adapted by LiveOrganiserProfile, or the
 * demo's sample events). `headingRef` makes the h1 focusable from script
 * (tabIndex -1), for a caller that moves focus to it.
 *
 * One column, in DOM order, below 1024px; from there the links sit in a
 * column beside the header and bio.
 */
export default function OrganiserProfileView({
  profile,
  upcoming,
  past,
  headingRef,
}: {
  profile: OrganiserProfileDetails;
  upcoming: readonly SheltuhEvent[];
  past: readonly SheltuhEvent[];
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const hasCover = Boolean(profile.coverUrl);
  const hasLinks = Boolean(profile.websiteUrl) || Object.values(profile.socialLinks).some(Boolean);
  // The list's chips in list order, then the organiser's own words as they wrote them. A profile from before
  // the chips existed (a cached one) has none: its reviewed categories stand in, as the API's do.
  const chips = [
    ...(profile.profileTags ?? tagsForEventCategories(profile.categories)).map((tag) => ({ key: tag, label: organiserTagLabel(tag) })),
    ...(profile.customTags ?? []).map((word, i) => ({ key: `own-${i}`, label: word })),
  ];
  const events =
    typeof profile.eventCount === "number" && profile.eventCount > 0 ? fact(profile.eventCount, "event", "events") : null;
  // The API sends a count only from 10 followers (null below).
  const followers =
    typeof profile.followerCount === "number" ? fact(profile.followerCount, "follower", "followers") : null;
  const now = new Date();

  return (
    <div className="page-container flex flex-col pt-2 pb-12 md:pt-4 md:pb-16 lg:pt-6 lg:pb-24">
      <BackLink href="/events">All events</BackLink>

      {profile.coverUrl && (
        <div className="mt-2 md:mt-4">
          <OrganiserCover url={profile.coverUrl} smallUrl={profile.coverSmallUrl} />
        </div>
      )}

      {/* From 1024px: header and bio in columns 1–7, the links in 9–12 beside both. The second row takes any
          extra height the links need, so the bio stays right under the header. */}
      <div className="lg:grid lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-8">
        <header className="flex flex-col lg:col-span-7">
          {/* The logo (or, for its organiser alone, "Add logo") over the cover's bottom-left corner, cut out of
              it by a ring of the page colour; in the flow without a cover. Empty (no logo, or one that failed),
              it's hidden, and the strap below takes its own spacing (peer-empty). */}
          <div
            data-organiser-logo-slot=""
            className={`peer w-fit empty:hidden ${
              hasCover ? "relative z-10 -mt-12 ml-4 sm:-mt-16 md:ml-6 lg:ml-8 xl:-mt-20" : "mt-2 md:mt-4"
            }`}
          >
            {profile.logoUrl ? (
              // Decorative: the h1 names them. If it can't load, it's left out.
              <OrganiserLogo
                name={profile.displayName}
                url={profile.logoUrl}
                size="profile"
                fallback="none"
                className="ring-4 ring-background"
              />
            ) : (
              <OwnLogoPrompt organiserId={profile.organiserId} overlap={hasCover} />
            )}
          </div>

          <div
            className={`mt-4 flex flex-col gap-2 md:mt-6 ${
              hasCover ? "peer-empty:mt-6 md:peer-empty:mt-8" : "peer-empty:mt-4 md:peer-empty:mt-4"
            }`}
          >
            <Strap label="Organiser" rule={false} />
            <h1
              ref={headingRef}
              tabIndex={headingRef ? -1 : undefined}
              className="display-lg break-words text-balance outline-offset-2"
            >
              {profile.displayName}
            </h1>
          </div>

          {/* A line of facts, with no separators (a wrap can't strand one). Member since is always there. */}
          <ul className="body-m mt-2 flex flex-wrap gap-x-6 gap-y-1 md:mt-3">
            {events && (
              <li>
                <span className="font-semibold text-foreground tabular-nums">{events.number}</span>{" "}
                <span className="font-medium text-muted">{events.label}</span>
              </li>
            )}
            {followers && (
              <li>
                <span className="font-semibold text-foreground tabular-nums">{followers.number}</span>{" "}
                <span className="font-medium text-muted">{followers.label}</span>
              </li>
            )}
            <li className="font-medium text-muted">Member since {formatMemberSince(profile.memberSince)}</li>
          </ul>

          <div className="mt-6">
            <FollowButton
              organiserId={profile.organiserId}
              organiserName={profile.displayName}
              variant="signal"
              size="md"
              buttonClassName="min-w-0 flex-1 sm:min-w-32 sm:flex-none"
              beside={
                <ShareButton
                  path={organiserProfilePath(profile.organiserId)}
                  title={profile.displayName}
                  text={`${profile.displayName} on Sheltüh`}
                  copyLabel="Link to this profile"
                  copiedInLabel
                  className="shrink-0"
                />
              }
            />
          </div>

          {chips.length > 0 && (
            <ul aria-label="Categories" className="mt-6 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.key} className="flex min-w-0">
                  <CategoryTag tone="neutral" size="md">
                    {chip.label}
                  </CategoryTag>
                </li>
              ))}
            </ul>
          )}
        </header>

        {profile.description && (
          <p className="body-l mt-6 max-w-2xl break-words whitespace-pre-line md:mt-8 lg:col-span-7 lg:row-start-2">
            {profile.description}
          </p>
        )}

        {hasLinks && (
          <section
            aria-labelledby="organiser-links"
            className={`mt-8 flex flex-col gap-3 md:max-w-xl lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:max-w-none lg:self-start ${
              // Level with the header's first line: the strap when the logo sits over a cover (the overlap + 24)
              // or when there's a cover and no logo (32); the logo or strap without a cover (16).
              hasCover ? (profile.logoUrl ? "lg:pt-22 xl:pt-26" : "lg:pt-8") : "lg:pt-4"
            }`}
          >
            <h2 id="organiser-links" className="eyebrow text-muted">
              Links
            </h2>
            <OrganiserLinks websiteUrl={profile.websiteUrl} socialLinks={profile.socialLinks} />
          </section>
        )}
      </div>

      <section aria-labelledby="organiser-upcoming" className={SECTION_GAP}>
        <SectionHead id="organiser-upcoming" title="Upcoming events" />
        {upcoming.length > 0 ? (
          <ul className={HOME_GRID}>
            {upcoming.map((event) => (
              <li key={event.id} className="flex min-w-0">
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="body-m text-muted">
            No upcoming events right now.{" "}
            <Link href="/events" className="text-foreground underline underline-offset-4 hover:decoration-2">
              Browse all events
            </Link>
          </p>
        )}
      </section>

      {profile.featuredVideo && (
        <section aria-labelledby="organiser-video" className={SECTION_GAP}>
          <SectionHead id="organiser-video" title="Featured video" />
          <div className="max-w-3xl">
            <VideoFacade video={profile.featuredVideo} title={`${profile.displayName}’s featured video`} />
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="organiser-past" className={SECTION_GAP}>
          <SectionHead id="organiser-past" title="Past events" />
          <ul className="border-t border-surface-border">
            {past.slice(0, PAST_EVENTS_SHOWN).map((event) => (
              <PastEventRow key={event.id} event={event} now={now} />
            ))}
          </ul>
        </section>
      )}

      <p className={`text-sm text-muted ${SECTION_GAP}`}>
        <a
          href={reportOrganiserHref(profile.displayName, profile.organiserId, siteOrigin(), SUPPORT_EMAIL)}
          className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4 hover:decoration-2"
        >
          Report this organiser
        </a>
      </p>
    </div>
  );
}

/**
 * One past event, like a line of a gallery's exhibition history: date |
 * title | place. The title is the row's one link, stretched over the row,
 * which draws its focus (an inset outline) and the hover and press fills,
 * with the title underlined on hover and focus alike. On phones the date
 * spans two lines beside the title, which sits over the place.
 */
function PastEventRow({ event, now }: { event: SheltuhEvent; now: Date }) {
  const place = eventPlaceName(event);
  return (
    <li className="group/row relative grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-4 border-b border-surface-border px-2 py-3 hover:bg-surface has-[a:active]:bg-surface-border has-[a:focus-visible]:bg-surface has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-foreground motion-safe:transition-colors motion-safe:duration-200 md:grid-cols-[8rem_minmax(0,1fr)_16rem] md:gap-x-6 md:px-3 md:py-4 lg:grid-cols-[8rem_minmax(0,1fr)_20rem]">
      <time dateTime={event.startsAt} className="mono-m text-muted max-md:row-span-2">
        {formatDayWithYear(event.startsAt, now, eventZone(event.timeZone))}
      </time>
      <Link
        href={`/events/${event.slug}`}
        className="body-m line-clamp-2 font-semibold break-words underline decoration-transparent underline-offset-4 group-hover/row:decoration-current after:absolute after:inset-0 after:content-[''] focus-visible:decoration-current focus-visible:outline-none"
      >
        {event.title}
      </Link>
      <span className="mono-m truncate text-muted max-md:col-start-2">
        {event.venueName.trim() ? `${event.venueName} · ${place}` : place}
      </span>
    </li>
  );
}
