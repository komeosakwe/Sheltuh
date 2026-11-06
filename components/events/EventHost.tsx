import Link from "next/link";
import OrganiserLinks from "@/components/organisers/OrganiserLinks";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import { Panel } from "@/components/ui/Section";
import type { OrganiserSocialLinks } from "@/lib/api/types";
import { getSampleOrganiser, organiserProfileHref, sampleOrganiserId } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

interface HostDetails {
  websiteUrl?: string;
  socialLinks: OrganiserSocialLinks;
  bio?: string;
}

/**
 * What the Host card shows besides the name. A live event carries it
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

/**
 * The event page's Host card: the organiser's logo (or initials), name and
 * "View profile", then their website and social links, then a bio excerpt.
 * Only what exists is shown; with no links or bio it's just the name and the
 * profile link.
 */
export default function EventHost({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const { websiteUrl, socialLinks, bio } = hostDetails(event, demo);
  const profileHref = organiserProfileHref(event);

  return (
    <Panel title="Host" titleId="host-title">
      <div data-event-host="" className="flex flex-col gap-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="lg" fallback="initials" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-heading text-xl leading-6 break-words">{event.organiserName}</p>
            {profileHref && (
              <Link
                href={profileHref}
                aria-label={`View profile of ${event.organiserName}`}
                className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:decoration-2"
              >
                View profile
              </Link>
            )}
          </div>
        </div>
        <OrganiserLinks websiteUrl={websiteUrl} socialLinks={socialLinks} layout="grid" />
        {bio && <p className="max-w-2xl text-sm leading-6 break-words whitespace-pre-line">{bio}</p>}
      </div>
    </Panel>
  );
}
