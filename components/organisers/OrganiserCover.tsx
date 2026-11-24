"use client";

import { useState } from "react";

/**
 * The image's rendered width (not the frame's): under a 176px height floor
 * `object-cover` draws a 7:2 image 616px wide on phones, so a 2× or 3× phone
 * picks the large file rather than a soft small one
 * (docs/design/organiser-profile.md §4.1).
 */
const COVER_SIZES =
  "(min-width: 80rem) min(calc(100vw - 8rem), 90rem), (min-width: 48rem) calc(100vw - 4rem), (min-width: 40.5rem) calc(100vw - 2rem), 616px";

/**
 * An organiser's cover photo across the top of their profile
 * (docs/design/organiser-profile.md §4.1, §5.2): a 7:2 frame at least 176px
 * tall (so phones get a taller, centre crop), the photo filling it. Nothing
 * is ever written on it, and it's decorative (`alt=""`): the h1 below names
 * the organiser. If the image fails (a takedown before a cached page catches
 * up, or the network), the frame keeps its size with a plain surface fill,
 * so nothing below it moves. `smallUrl` (1120 px) is offered beside `url`
 * (2240 px) when there is one; the demo's sample photos have none.
 */
export default function OrganiserCover({ url, smallUrl }: { url: string; smallUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;

  return (
    <div data-organiser-cover="" className="relative aspect-7/2 min-h-44 w-full overflow-hidden rounded-card bg-surface">
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image, already sized (2240/1120 px) and versioned by the server
        <img
          src={url}
          srcSet={smallUrl ? `${smallUrl} 1120w, ${url} 2240w` : undefined}
          sizes={smallUrl ? COVER_SIZES : undefined}
          width={2240}
          height={640}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          // On a server-rendered page the image can fail before React attaches
          // onError; catch that here so the plain frame still shows.
          ref={(img) => {
            if (img && img.complete && img.currentSrc && img.naturalWidth === 0) setFailedUrl(url);
          }}
          onError={() => setFailedUrl(url)}
          className="absolute inset-0 size-full object-cover object-center"
        />
      )}
    </div>
  );
}
