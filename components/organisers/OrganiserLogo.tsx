"use client";

import { useState, type ReactNode } from "react";
import InitialsAvatar from "@/components/ui/InitialsAvatar";

/** The same boxes as InitialsAvatar's sizes, so a logo and initials swap without a shift. */
const SIZES = {
  md: { box: "size-8", px: 32 },
  /** The event page's Organiser card (the owner's event mock). */
  card: { box: "size-12", px: 48 },
  lg: { box: "size-24 sm:size-32", px: 128 },
  /** The organiser's profile header: `lg` with a step up at 1280px (96 / 128 / 160). */
  profile: { box: "size-24 sm:size-32 xl:size-40", px: 160 },
  /** The box it's in decides (the dashboard sidebar's 112px mark, its rail's 40px: OrganiserAvatar). */
  fill: { box: "size-full", px: 112 },
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
  fallbackElement,
  shape = "dot",
  className = "",
}: {
  name: string;
  /** `logoUrl` or `organiserLogoThumbUrl` from the API; unset: the fallback. */
  url?: string;
  size: keyof typeof SIZES;
  fallback: "initials" | "none";
  /** Shown instead of `fallback` with no logo (the dashboard's orange initials disc). */
  fallbackElement?: ReactNode;
  /** `round`: a circle filled edge to edge, no rule (the dashboard sidebar's mark); `dot`: the rounded square. */
  shape?: "dot" | "round";
  /** Added to the box (the profile's cut-out ring over a cover). */
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { box, px } = SIZES[size];

  if (!url || failedUrl === url) {
    if (fallbackElement !== undefined) return <>{fallbackElement}</>;
    if (fallback === "none") return null;
    return <InitialsAvatar name={name} size={size === "profile" ? "lg" : size === "fill" ? "sidebar" : size} shape="logo" />;
  }

  return (
    <span
      aria-hidden="true"
      data-organiser-logo=""
      className={`flex shrink-0 overflow-hidden bg-paper ${
        shape === "round" ? "rounded-full" : "rounded-dot border border-foreground"
      } ${box} ${className}`.trim()}
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
        className={`size-full ${shape === "round" ? "object-cover" : "object-contain"}`}
      />
    </span>
  );
}
