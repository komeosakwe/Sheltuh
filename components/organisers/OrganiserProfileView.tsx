import Link from "next/link";
import type { Ref } from "react";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import { RESULTS_GRID } from "@/components/EventResults";
import BackLink from "@/components/ui/BackLink";
import EventTile from "@/components/ui/EventTile";
import Strap from "@/components/ui/Strap";
import { SectionHeader } from "@/components/ui/Section";
import type { PublicOrganiserProfile } from "@/lib/api/types";
import { formatDayWithYear } from "@/lib/format";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { formatMemberSince } from "@/lib/organiser-profile";
import { EVENT_CATEGORIES } from "@/lib/types";

/**
 * An approved organiser's public profile: who they are, their links, then
 * their events. `headingRef` makes the h1 focusable from script (tabIndex
 * -1), for a caller that moves focus to it.
 */
export default function OrganiserProfileView({
  profile,
  headingRef,
}: {
  profile: PublicOrganiserProfile;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const categoryLabels = profile.categories.map(
    (value) => EVENT_CATEGORIES.find((category) => category.value === value)?.label ?? value,
  );
  const upcoming = profile.upcomingEvents.map(adaptPublicEvent);
  const past = profile.recentEvents.map(adaptPublicEvent);
  const hasLinks = Boolean(profile.websiteUrl) || Object.values(profile.socialLinks).some(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 pt-2 pb-12 sm:gap-14 sm:px-8 sm:py-14">
      <BackLink href="/events">All events</BackLink>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
        <header className="flex flex-col gap-5 lg:col-span-7">
          <Strap label="Organiser" rule={false} />
          <h1
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="display-lg break-words outline-offset-2"
          >
            {profile.displayName}
          </h1>
          <p className="meta text-muted">Member since {formatMemberSince(profile.memberSince)}</p>
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

        {hasLinks && (
          <section aria-labelledby="organiser-links" className="flex flex-col gap-3 md:max-w-xl lg:col-span-5 lg:max-w-none">
            <h2 id="organiser-links" className="eyebrow font-sans text-muted">
              Links
            </h2>
            <OrganiserLinks websiteUrl={profile.websiteUrl} socialLinks={profile.socialLinks} />
          </section>
        )}
      </div>

      <section aria-labelledby="organiser-upcoming">
        <SectionHeader id="organiser-upcoming" title="Upcoming events" />
        {upcoming.length > 0 ? (
          <ul data-reveal-stagger className={RESULTS_GRID}>
            {upcoming.map((event) => (
              <li key={event.id} className="flex min-w-0">
                <EventTile event={event} showOrganiser={false} className="w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-foreground pt-5 text-sm text-muted">
            No upcoming events right now.{" "}
            <Link href="/events" className="text-foreground underline underline-offset-4">
              Browse all events
            </Link>
          </p>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="organiser-past">
          <SectionHeader id="organiser-past" title="Past events" />
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
