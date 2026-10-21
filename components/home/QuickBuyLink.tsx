import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { quickBuyLabel } from "@/lib/quick-buy";
import type { SheltuhEvent } from "@/lib/types";
import { ArrowRightIcon } from "./icons";

/**
 * A card's "Get tickets" button (docs/design/brand-direction-one.md §6.6, owner
 * decision 6): a sibling of the card's main link, straight to the event page's
 * ticket section. Signal Orange with a black label (6.18:1, never white), 44px
 * tall on phones and 40px from 640px; hover turns it black with an orange
 * label, a press nudges it (motion-safe), and keyboard focus is the page's
 * black ring on a cream gap (never orange). Renders nothing, and no wrapper,
 * when there's nothing to get yet.
 *
 * `className` goes on the wrapper row (spacing, indent); `fullWidthOnPhones`
 * stretches the button across that row below 640px.
 */
export default function QuickBuyLink({
  event,
  mode,
  className = "",
  fullWidthOnPhones = false,
}: {
  event: SheltuhEvent;
  mode: "demo" | "live";
  className?: string;
  fullWidthOnPhones?: boolean;
}) {
  const label = quickBuyLabel(event, mode);
  if (!label) return null;
  return (
    <div className={`flex ${className}`.trim()}>
      <Link
        href={`/events/${event.slug}#tickets`}
        className={buttonClass(
          "signal",
          "md",
          `min-h-11 px-4 sm:min-h-10 focus-visible:outline-ink ${fullWidthOnPhones ? "w-full sm:w-auto" : "self-start"}`,
        )}
      >
        {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
        <span className="sr-only">
          {label} for {event.title}
        </span>
        <span aria-hidden="true">{label}</span>
        <ArrowRightIcon />
      </Link>
    </div>
  );
}
