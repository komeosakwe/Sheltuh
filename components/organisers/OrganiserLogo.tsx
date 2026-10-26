"use client";

import { useState } from "react";
import InitialsAvatar from "@/components/ui/InitialsAvatar";

/** The same boxes as InitialsAvatar's sizes, so a logo and initials swap without a shift. */
const SIZES = {
  md: { box: "size-8", px: 32 },
  lg: { box: "size-24 sm:size-32", px: 128 },
} as const;

/**
 * An organiser's logo (docs/architecture.md, "Organiser profiles" → Logo) in
 * the avatar's rounded square with a 1px foreground edge. The server already
 * fitted it on a white square, so it sits on `paper` (white in both themes).
 * Decorative (`alt=""`, `aria-hidden`): the organiser's name beside it is
 * what's read.
 *
 * With no `url`, or when the image fails (a takedown, say, before a cached
 * page catches up), it shows the `fallback`: the organiser's initials, or
 * nothing at all.
 */
export default function OrganiserLogo({
  name,
  url,
  size,
  fallback,
}: {
  name: string;
  /** `logoUrl` or `organiserLogoThumbUrl` from the API; unset: the fallback. */
  url?: string;
  size: keyof typeof SIZES;
  fallback: "initials" | "none";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { box, px } = SIZES[size];

  if (!url || failedUrl === url) {
    return fallback === "initials" ? <InitialsAvatar name={name} size={size} /> : null;
  }

  return (
    <span
      aria-hidden="true"
      data-organiser-logo=""
      className={`flex shrink-0 overflow-hidden rounded-dot border border-foreground bg-paper ${box}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin API image, already sized (96/512 px) and versioned by the server */}
      <img
        src={url}
        alt=""
        width={px}
        height={px}
        decoding="async"
        // On a server-rendered page the image can fail before React attaches
        // onError; catch that here so the fallback still shows.
        ref={(img) => {
          if (img && img.complete && img.currentSrc && img.naturalWidth === 0) setFailedUrl(url);
        }}
        onError={() => setFailedUrl(url)}
        className="size-full object-contain"
      />
    </span>
  );
}
