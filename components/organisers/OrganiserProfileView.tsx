import Link from "next/link";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import EventTile from "@/components/ui/EventTile";
import { SectionHeader } from "@/components/ui/Section";
import type { PublicOrganiserProfile } from "@/lib/api/types";
import { formatDayWithYear } from "@/lib/format";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { formatMemberSince } from "@/lib/organiser-profile";
import { EVENT_CATEGORIES } from "@/lib/types";

/** An approved organiser's public profile: who they are, their links, then their events. */
export default function OrganiserProfileView({ profile }: { profile: PublicOrganiserProfile }) {
  const categoryLabels = profile.categories.map(
    (value) => EVENT_CATEGORIES.find((category) => category.value === value)?.label ?? value,
  );
  const upcoming = profile.upcomingEvents.map(adaptPublicEvent);
  const past = profile.recentEvents.map(adaptPublicEvent);
  const hasLinks = Boolean(profile.websiteUrl) || Object.values(profile.socialLinks).some(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 pt-2 pb-12 sm:gap-14 sm:px-8 sm:py-14">
      <Link
        href="/events"
        className="eyebrow inline-flex min-h-11 w-fit items-center underline underline-offset-4"
      >
        &larr; All events
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
        <header className="flex flex-col gap-5 lg:col-span-7">
          <p className="eyebrow text-muted">Organiser</p>
          <h1 className="display-lg break-words">{profile.displayName}</h1>
          <p className="text-sm text-muted">Member since {formatMemberSince(profile.memberSince)}</p>
          {categoryLabels.length > 0 && (
            <ul aria-label="Categories" className="flex flex-wrap gap-2">
              {categoryLabels.map((label) => (
                <li key={label} className="eyebrow border border-foreground px-2 py-1">
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
          <section aria-labelledby="organiser-links" className="flex flex-col gap-3 lg:col-span-5 lg:pt-10">
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
          <ul className="grid grid-cols-1 gap-y-8 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {upcoming.map((event) => (
              <li key={event.id}>
                <EventTile event={event} showOrganiser={false} />
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
        <section aria-labelledby="organiser-past" className="flex flex-col gap-4">
          <h2 id="organiser-past" className="display-md !text-2xl">
            Past events
          </h2>
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
                  <span className="shrink-0 text-sm text-muted">
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
