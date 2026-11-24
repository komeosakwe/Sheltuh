import { useId } from "react";
import UMark from "@/components/brand/UMark";
import ShareButton from "@/components/ShareButton";
import type { OrganiserEventSummary } from "@/lib/api/types";
import { highlightLine } from "@/lib/organiser-dashboard";

/**
 * The Overview's "Highlight banner" (Latte 430:7340): orange, radius 16, 40px in on the left, 48
 * on the right and 32 above and below at every width (the 390 frame keeps them), "Nice work!" in Heading/H2, the line under it in Body/M,
 * the black "Share event →" chip, and the black Ü (96 tall) at the right; on phones the Ü sits under
 * the words, as the 390 frame places it. An orange section (data-surface="signal"), so everything in
 * it is black on orange (6.18:1). Shown only for the API's `highlight` (the soonest live event that
 * has sold at least one ticket and has some left); nothing else is drawn for the banner, so without
 * one there's no banner.
 */
export default function HighlightBanner({ event, now }: { event: OrganiserEventSummary; now: Date }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-surface="signal"
      data-highlight-banner={event.eventId}
      className="flex flex-col gap-6 rounded-card py-8 pr-12 pl-10 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        {/* The region is named with its event: "Nice work! Here & Now is selling". */}
        <h2 id={titleId} className="heading-dash break-words">
          Nice work!{" "}
          <span className="sr-only">{event.title} is selling</span>
        </h2>
        <p className="body-m break-words">{highlightLine(event, now)}</p>
        {event.slug && (
          <ShareButton
            slug={event.slug}
            title={event.title}
            label="Share event"
            className="flex-wrap"
            buttonClassName="label-tag inline-flex min-h-8 max-w-full flex-wrap items-center gap-1 rounded-control bg-ink px-4 py-2 text-left whitespace-normal text-paper hover:bg-accent-strong pointer-coarse:min-h-11"
          />
        )}
      </div>
      <UMark className="h-24 w-auto shrink-0 self-center" />
    </section>
  );
}
