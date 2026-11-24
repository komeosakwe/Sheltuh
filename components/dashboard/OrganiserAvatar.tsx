"use client";

import { useState } from "react";
import { initialsFor } from "@/lib/initials";

const SIZES = {
  /** The sidebar's 112px circle: initials SemiBold 32/40 (Heading/H2; 28/36 in the phone drawer). */
  sidebar: "size-28 heading-h2",
  /** The rail's 40px circle: initials Medium 12/16. */
  rail: "size-10 text-xs leading-4 font-medium",
} as const;

/**
 * The organiser's mark at the top of the sidebar and the rail (Latte's "Org / Sidebar" Avatar):
 * a round orange disc with their initials in black (6.18:1), or their logo in the circle when
 * they've uploaded one (shown only once approved, when the logo is public). Decorative: the name
 * beside it (or the nav's own name, on the rail) is what's read. If the logo fails to load (a
 * takedown, say) the initials come back.
 */
export default function OrganiserAvatar({
  name,
  logoUrl,
  size,
}: {
  name: string;
  logoUrl?: string;
  size: keyof typeof SIZES;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = Boolean(logoUrl) && failedUrl !== logoUrl;
  return (
    <span
      aria-hidden="true"
      data-organiser-avatar={size}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-signal text-signal-foreground ${SIZES[size]}`}
    >
      {showLogo && logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image, already sized and versioned by the server
        <img src={logoUrl} alt="" className="size-full bg-paper object-cover" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}
