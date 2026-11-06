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
      {/* The X mark: a broad stroke drawn as an outline from top left to bottom
          right, crossed by a thin one that breaks where it meets it. */}
      {kind === "x" && <path d="M4 4h4.5l11.5 16h-4.5ZM19.5 4 13.8 10.1M10.4 13.7 4.5 20" />}
      {/* Spotify, SoundCloud, YouTube and LinkedIn: plain geometric marks (a disc with
          sound arcs, a cloud with level bars, a play button, "in"), not the brands' artwork. */}
      {kind === "spotify" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M7.5 9.6c3-.9 6.2-.6 9 .9M8.2 12.7c2.5-.6 5-.4 7.4.8M9 15.5c2-.4 4-.2 5.8.6" />
        </>
      )}
      {kind === "soundcloud" && (
        <path d="M3.5 14v3.5M6.5 12v5.5M9.5 10.2v8.3h8a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 9.5 10.2Z" />
      )}
      {kind === "youtube" && (
        <>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="m10 9.5 4.5 2.5-4.5 2.5Z" />
        </>
      )}
      {kind === "linkedin" && (
        <>
          <circle cx="5.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
          <path d="M5.5 10.5v8M10.5 18.5v-8M10.5 14c0-2.2 1.6-3.5 3.5-3.5s3.5 1.3 3.5 3.5v4.5" />
        </>
      )}
      {kind === "website" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5Z" />
        </>
      )}
    </svg>
  );
}
