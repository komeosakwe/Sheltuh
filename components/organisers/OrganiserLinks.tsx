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
 * Renders nothing when there are no links. `layout="grid"` (the event page's
 * Host card) sets them two to a row from 640px, one per row below.
 */
export default function OrganiserLinks({
  websiteUrl,
  socialLinks,
  layout = "list",
}: {
  websiteUrl?: string;
  socialLinks: OrganiserSocialLinks;
  layout?: "list" | "grid";
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
    <ul
      className={
        layout === "grid"
          ? "grid grid-cols-1 gap-x-8 border-t border-surface-border sm:grid-cols-2"
          : "flex flex-col border-t border-surface-border"
      }
    >
      {items.map((item) => (
        <li key={item.key} className="min-w-0 border-b border-surface-border">
          <a
            href={item.href}
            target="_blank"
            rel={item.rel}
            // The whole name, spelled out: "Instagram: @name (opens in a new tab)".
            aria-label={`${item.label}${item.detail ? `: ${item.detail}` : ""} (opens in a new tab)`}
            className={`group flex items-center gap-3 py-2 text-sm ${layout === "grid" ? "min-h-14" : "min-h-11"}`}
          >
            <OrganiserLinkIcon kind={item.key} className="size-5 shrink-0" />
            {/* In the grid the name sits over its handle, which is cut short with an ellipsis (the
                aria-label has it whole), so every cell is the same height. */}
            <span
              className={
                layout === "grid"
                  ? "flex min-w-0 flex-col"
                  : "flex min-w-0 flex-wrap items-baseline gap-x-2"
              }
            >
              <span className="font-semibold group-hover:underline group-hover:underline-offset-4">
                {item.label}
              </span>
              {item.detail && (
                <span className={layout === "grid" ? "min-w-0 truncate text-muted" : "min-w-0 break-all text-muted"}>
                  {item.detail}
                </span>
              )}
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
              className="ml-auto size-3.5 shrink-0 text-muted"
            >
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
