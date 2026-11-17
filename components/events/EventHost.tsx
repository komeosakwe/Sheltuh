"use client";

import { useEventOrganiser } from "@/components/events/EventOrganiserProvider";
import FollowButton from "@/components/organisers/FollowButton";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import { ButtonLink } from "@/components/ui/Button";
import type { OrganiserSocialLinks } from "@/lib/api/types";
import { getSampleOrganiser, organiserProfileHref, sampleOrganiserId } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

interface HostDetails {
  websiteUrl?: string;
  socialLinks: OrganiserSocialLinks;
  bio?: string;
}

/**
 * What the Organiser card shows besides the name. A live event carries it
 * (organiserWebsiteUrl, organiserSocialLinks and organiserBio, only for an
 * approved organiser). A demo event has no organiserId and none of those, so
 * its sample organiser's profile stands in (lib/sample-organisers.ts).
 */
function hostDetails(event: SheltuhEvent, demo: boolean): HostDetails {
  if (demo && !event.organiserId) {
    const sample = getSampleOrganiser(sampleOrganiserId(event.organiserName));
    if (sample) {
      const { websiteUrl, socialLinks, description } = sample.profile;
      return { websiteUrl, socialLinks, bio: description };
    }
  }
  return {
    websiteUrl: event.organiserWebsiteUrl,
    socialLinks: event.organiserSocialLinks ?? {},
    bio: event.organiserBio,
  };
}

/** "1.2K" (the owner's mock): followers in short form. */
const compactCount = new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 });

/** Whose profile Follow is for: a live organiser's id, or in the demo the sample organiser's (Follow is unavailable there). */
function followId(event: SheltuhEvent): string | null {
  if (!organiserProfileHref(event)) return null;
  return event.organiserId ?? sampleOrganiserId(event.organiserName);
}

/**
 * The event page's Organiser card (the owner's event mock): a cream card with an "Organiser" eyebrow, their
 * logo (or initials) and name, a mono line with their followers (only once the API sends a count: 10 or
 * more) and "✓ Checked" (every organiser with a public profile was approved by a person; live only, from
 * the page's one profile read, EventOrganiserProvider), their bio, their website and social links, then
 * Follow (the existing organiser follows, with its unticked email choice) and View profile. Only what
 * exists is shown; with no profile to link to, it's the name, bio and links.
 */
export default function EventHost({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const { websiteUrl, socialLinks, bio } = hostDetails(event, demo);
  const { load } = useEventOrganiser();
  const profileHref = organiserProfileHref(event);
  const organiserId = followId(event);
  const facts = [
    load.status === "ready" && load.followerCount !== null ? `${compactCount.format(load.followerCount)} followers` : null,
    load.status === "ready" && load.checked ? "✓ Checked" : null,
  ].filter((fact): fact is string => fact !== null);
  const viewProfile = profileHref && (
    <ButtonLink href={profileHref} variant="outline" size="md" aria-label={`View profile of ${event.organiserName}`}>
      View profile
    </ButtonLink>
  );

  return (
    <section aria-labelledby="host-title" data-event-host="" className="flex flex-col gap-4 rounded-card bg-hover p-6">
      <h2 id="host-title" className="eyebrow text-muted">
        Organiser
      </h2>
      <div className="flex items-center gap-4">
        <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="card" fallback="initials" />
        <div className="flex min-w-0 flex-col">
          <p className="heading-h4 break-words">{event.organiserName}</p>
          {facts.length > 0 && <p className="mono-s text-muted">{facts.join(" · ")}</p>}
        </div>
      </div>
      {bio && <p className="body-s max-w-2xl break-words whitespace-pre-line">{bio}</p>}
      <OrganiserLinks websiteUrl={websiteUrl} socialLinks={socialLinks} layout="grid" />
      {organiserId ? (
        <FollowButton
          organiserId={organiserId}
          organiserName={event.organiserName}
          returnTo={`/events/${event.slug}`}
          size="md"
          beside={viewProfile}
        />
      ) : (
        viewProfile
      )}
    </section>
  );
}
