"use client";

import type { MouseEvent } from "react";
import { ExternalIcon } from "@/components/home/icons";
import { recordOutboundClick } from "@/lib/api/analytics";
import { isSafeTicketUrl } from "@/lib/event-url";

/**
 * An external event's "Get tickets" link (docs/architecture.md,
 * "External ticketing"). Opens the ticketing site in a new tab, without
 * giving it a handle on this page (`noopener`) or this page's address
 * (`noreferrer`), and counts the click with a cookie-free beacon that's
 * fired, never awaited, so the link opens straight away. Renders nothing
 * unless the link is https.
 */
export default function ExternalTicketLink({
  eventId,
  url,
  className,
  preview = false,
}: {
  eventId: string;
  url: string | undefined;
  className: string;
  /** The editor's live preview: the link looks the same but counts nothing. */
  preview?: boolean;
}) {
  if (!isSafeTicketUrl(url)) return null;

  function count() {
    if (preview) return;
    recordOutboundClick(eventId);
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={count}
      // A middle-click opens the link in a new tab too.
      onAuxClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button === 1) count();
      }}
      // The whole name, spelled out (as OrganiserLinks does): it starts with the
      // visible words, and says where it goes and that it opens a new tab.
      aria-label="Get tickets (opens in a new tab)"
      className={className}
    >
      {/* Never the ticket site's name (owner, 31 Oct 2026): buyers go through this link. */}
      Get tickets
      <ExternalIcon />
    </a>
  );
}
