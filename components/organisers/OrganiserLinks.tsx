import OrganiserLinkIcon from "@/components/organisers/OrganiserLinkIcon";
import type { OrganiserSocialLinks } from "@/lib/api/types";
import {
  displayHandle,
  SOCIAL_NETWORKS,
  socialHandleFromUrl,
  websiteHostname,
  type SocialNetwork,
} from "@/lib/organiser-profile";

interface LinkItem {
  key: SocialNetwork | "website";
  href: string;
  label: string;
  detail: string | null;
  rel: string;
}

/**
 * The organiser's website and social profiles, each a new-tab link with a
 * text label ("Instagram: @name") and a visible new-tab arrow, which the
 * aria-label also says in words. The website is organiser-supplied, so it's
 * nofollow ugc; social URLs are built by the server from validated handles.
 * Renders nothing when there are no links.
 */
export default function OrganiserLinks({
  websiteUrl,
  socialLinks,
}: {
  websiteUrl?: string;
  socialLinks: OrganiserSocialLinks;
}) {
  const items: LinkItem[] = [];
  const hostname = websiteUrl ? websiteHostname(websiteUrl) : null;
  if (websiteUrl && hostname) {
    items.push({
      key: "website",
      href: websiteUrl,
      label: "Website",
      detail: hostname,
      rel: "noopener noreferrer nofollow ugc",
    });
  }
  for (const { network, label } of SOCIAL_NETWORKS) {
    const href = socialLinks[network];
    if (!href) continue;
    const handle = socialHandleFromUrl(href);
    items.push({
      key: network,
      href,
      label,
      detail: handle ? displayHandle(network, handle) : null,
      rel: "noopener noreferrer",
    });
  }

  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col border-t border-surface-border">
      {items.map((item) => (
        <li key={item.key} className="border-b border-surface-border">
          <a
            href={item.href}
            target="_blank"
            rel={item.rel}
            // The whole name, spelled out: "Instagram: @name (opens in a new tab)".
            aria-label={`${item.label}${item.detail ? `: ${item.detail}` : ""} (opens in a new tab)`}
            className="group flex min-h-11 items-center gap-3 py-2 text-sm"
          >
            <OrganiserLinkIcon kind={item.key} className="size-5 shrink-0" />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="font-semibold group-hover:underline group-hover:underline-offset-4">
                {item.label}
              </span>
              {item.detail && <span className="min-w-0 break-all text-muted">{item.detail}</span>}
            </span>
            {/* Seen, not read: the aria-label already says it opens in a new tab. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5 shrink-0 text-muted"
            >
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
