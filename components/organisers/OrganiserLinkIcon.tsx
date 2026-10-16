import type { SocialNetwork } from "@/lib/organiser-profile";

/**
 * Simple line marks for an organiser's links (decorative: the link around
 * each one carries the name in text).
 */
export default function OrganiserLinkIcon({
  kind,
  className = "size-5",
}: {
  kind: SocialNetwork | "website";
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {kind === "instagram" && (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.25" cy="6.75" r="0.75" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "tiktok" && <path d="M13.5 3.5v11.25a3.75 3.75 0 1 1-3.75-3.75M13.5 3.5c.4 2.6 2.4 4.5 5 4.75" />}
      {kind === "facebook" && <path d="M15.5 3.5h-2a4 4 0 0 0-4 4v13M6.5 11h8" />}
      {kind === "x" && <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />}
      {kind === "website" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5Z" />
        </>
      )}
    </svg>
  );
}
