"use client";

import { useEffect, useRef, useState } from "react";
import { featuredVideoEmbedUrl, featuredVideoPageUrl, type FeaturedVideo } from "@/lib/api/featured-video";

const PROVIDER_NAMES: Record<FeaturedVideo["provider"], string> = { youtube: "YouTube", vimeo: "Vimeo" };

/**
 * YouTube's still for a video, from its static image host (no cookies). Vimeo
 * has no static still without calling its API, so a Vimeo facade is a plain
 * panel: nothing is requested from Vimeo before the press.
 */
function thumbnailUrl(video: FeaturedVideo): string | null {
  return video.provider === "youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg` : null;
}

/**
 * An organiser's featured video as a click-to-load facade (docs/architecture.md,
 * "Organiser profiles"): a still and a play button, and nothing from the
 * video site's player until it's pressed (no third-party cookies before, and
 * it never starts on its own). Pressing it loads the privacy-enhanced player
 * (youtube-nocookie.com, or Vimeo with `dnt=1`), which starts because the
 * press was the play action, and moves focus into it so keyboard users carry
 * on there. A plain "Watch on YouTube" link is always offered too.
 *
 * `title` names the video (for the button, the iframe's title and the link).
 */
export default function VideoFacade({ video, title }: { video: FeaturedVideo; title: string }) {
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const provider = PROVIDER_NAMES[video.provider];
  const thumb = thumbnailUrl(video);

  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  return (
    <div className="flex flex-col gap-2">
      {/* No overflow-hidden here: the play button's focus ring is drawn outside it, on the page. */}
      <div className="relative aspect-video w-full rounded-card bg-ink">
        {playing ? (
          <iframe
            ref={frameRef}
            src={featuredVideoEmbedUrl(video)}
            title={`${title} (${provider} video)`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            // YouTube's embeds need the page's origin as the referrer to play.
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full rounded-card border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 flex size-full items-center justify-center rounded-card"
          >
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element -- a remote still on the video site's cookie-free image host
              <img
                src={thumb}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="absolute inset-0 size-full rounded-card object-cover"
              />
            )}
            <span className="relative flex items-center gap-3 rounded-control bg-cream px-4 py-3 text-ink motion-safe:transition-transform motion-safe:group-hover:scale-105">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 fill-current">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
              <span className="text-sm font-semibold uppercase tracking-[0.02em]">
                Play video<span className="sr-only">: {title}</span>
              </span>
            </span>
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {playing
          ? `Playing from ${provider}.`
          : `Pressing play loads ${provider}’s player${video.provider === "youtube" ? " (privacy-enhanced mode)" : " (without tracking)"}.`}{" "}
        <a
          href={featuredVideoPageUrl(video)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center text-foreground underline underline-offset-2"
        >
          <span>
            Watch on {provider} <span className="sr-only">(opens in a new tab)</span>
          </span>
        </a>
      </p>
    </div>
  );
}
