import Link from "next/link";
import type { Ref } from "react";
import FollowButton from "@/components/organisers/FollowButton";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import VideoFacade from "@/components/organisers/VideoFacade";
import { RESULTS_GRID } from "@/components/EventResults";
import BackLink from "@/components/ui/BackLink";
import EventCard from "@/components/ui/EventCard";
import Strap from "@/components/ui/Strap";
import SectionHead from "@/components/ui/SectionHead";
import { formatDayWithYear } from "@/lib/format";
import { formatMemberSince, type OrganiserProfileDetails } from "@/lib/organiser-profile";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

const countFormatter = new Intl.NumberFormat("en-AU");

/**
 * An approved organiser's public profile: who they are (with their logo,
 * when they have one), Follow, their numbers (followers once there are 10,
 * events hosted), their links and featured video, then their events: `upcoming` (soonest first) and `past`
 * (most recent first), already in the screens' shape (a live profile's
 * events adapted by LiveOrganiserProfile, or the demo's sample events).
 * `headingRef` makes the h1 focusable from script (tabIndex -1), for a caller
 * that moves focus to it.
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
  const categoryLabels = profile.categories.map(
    (value) => EVENT_CATEGORIES.find((category) => category.value === value)?.label ?? value,
  );
  const hasLinks = Boolean(profile.websiteUrl) || Object.values(profile.socialLinks).some(Boolean);
  const title = (
    <>
      <Strap label="Organiser" rule={false} />
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="display-lg break-words outline-offset-2"
      >
        {profile.displayName}
      </h1>
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 pt-2 pb-12 sm:gap-14 sm:px-8 sm:py-14">
      <BackLink href="/events">All events</BackLink>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
        <header className="flex flex-col gap-5 lg:col-span-7">
          {profile.logoUrl ? (
            // Their logo beside the strap and name from sm (stacked on phones, as on a member's
            // profile). Decorative: the h1 names them. If it can't load, it's left out.
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
              <OrganiserLogo name={profile.displayName} url={profile.logoUrl} size="lg" fallback="none" />
              <div className="flex min-w-0 flex-col gap-5">{title}</div>
            </div>
          ) : (
            title
          )}
          <p className="meta text-muted">Member since {formatMemberSince(profile.memberSince)}</p>
          {/* Followers only once the API sends a count (10 or more); events hosted (past events). */}
          <dl className="flex flex-wrap gap-x-8 gap-y-3 empty:hidden">
            {typeof profile.followerCount === "number" && (
              <div className="flex flex-col">
                <dt className="eyebrow text-muted">Followers</dt>
                <dd className="font-heading text-[2rem] leading-9 tracking-[-0.03em] tabular-nums lg:text-[2.5rem] lg:leading-11">
                  {countFormatter.format(profile.followerCount)}
                </dd>
              </div>
            )}
            {typeof profile.eventsHosted === "number" && (
              <div className="flex flex-col">
                <dt className="eyebrow text-muted">Events hosted</dt>
                <dd className="font-heading text-[2rem] leading-9 tracking-[-0.03em] tabular-nums lg:text-[2.5rem] lg:leading-11">
                  {countFormatter.format(profile.eventsHosted)}
                </dd>
              </div>
            )}
          </dl>
          <FollowButton organiserId={profile.organiserId} organiserName={profile.displayName} />
          {categoryLabels.length > 0 && (
            <ul aria-label="Categories" className="flex flex-wrap gap-2">
              {categoryLabels.map((label) => (
                <li key={label} className="eyebrow rounded-badge border border-foreground bg-card px-2 py-1">
                  {label}
                </li>
              ))}
            </ul>
          )}
          {profile.description && (
            <p className="max-w-2xl whitespace-pre-line break-words text-base leading-relaxed sm:text-lg">
              {profile.description}
            </p>
          )}
        </header>

        {(hasLinks || profile.featuredVideo) && (
          <div className="flex flex-col gap-8 md:max-w-xl lg:col-span-5 lg:max-w-none">
            {profile.featuredVideo && (
              <section aria-labelledby="organiser-video" className="flex flex-col gap-3">
                <h2 id="organiser-video" className="eyebrow text-muted">
                  Featured video
                </h2>
                <VideoFacade video={profile.featuredVideo} title={`${profile.displayName}’s featured video`} />
              </section>
            )}
            {hasLinks && (
              <section aria-labelledby="organiser-links" className="flex flex-col gap-3">
                <h2 id="organiser-links" className="eyebrow text-muted">
                  Links
                </h2>
                <OrganiserLinks websiteUrl={profile.websiteUrl} socialLinks={profile.socialLinks} />
              </section>
            )}
          </div>
        )}
      </div>

      <section aria-labelledby="organiser-upcoming">
        <SectionHead id="organiser-upcoming" title="Upcoming events" />
        {upcoming.length > 0 ? (
          <ul className={RESULTS_GRID}>
            {upcoming.map((event) => (
              <li key={event.id} className="flex min-w-0">
                <EventCard event={event} variant="grid" showOrganiser={false} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No upcoming events right now.{" "}
            <Link href="/events" className="text-foreground underline underline-offset-4">
              Browse all events
            </Link>
          </p>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="organiser-past">
          <SectionHead id="organiser-past" title="Past events" />
          <ul className="flex flex-col border-t border-surface-border">
            {past.map((event) => (
              <li key={event.id} className="border-b border-surface-border">
                <Link
                  href={`/events/${event.slug}`}
                  className="group flex min-h-11 flex-col justify-center gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <span className="text-sm font-semibold group-hover:underline group-hover:underline-offset-4">
                    {event.title}
                  </span>
                  <span className="meta shrink-0 text-muted">
                    {formatDayWithYear(event.startsAt)} · {event.venueName || event.suburb}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
