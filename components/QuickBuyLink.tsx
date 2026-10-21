import Link from "next/link";
import { ArrowRightIcon } from "@/components/home/icons";
import { buttonClass } from "@/components/ui/Button";
import { quickBuyHref, quickBuyLabel } from "@/lib/quick-buy";
import type { SheltuhEvent } from "@/lib/types";

/**
 * A card's or list row's "Buy tickets" button (docs/design/brand-direction-one.md
 * §6.6, owner decision 6 and the owner's wording of 21 Oct 2026): a sibling
 * of the card's main link, straight to the event page's ticket section (a
 * seated event's seat page: lib/quick-buy.ts quickBuyHref).
 * Signal Orange with a black label (6.18:1, never white), 44px tall on phones
 * and 40px from 640px; hover turns it black with an orange label, a press
 * nudges it (motion-safe), and keyboard focus is the page's black ring on a
 * cream gap (never orange). Renders nothing, and no wrapper, when there's
 * nothing to get yet.
 *
 * `className` goes on the wrapper row (spacing, indent); `fullWidthOnPhones`
 * stretches the button across that row below 640px. `narrow` is for the
 * two-column phone grid (cards ~134px wide at 320): below 640px the button
 * fills the card, the label is 12px, and the arrow drops, so it fits.
 * `fill` fills the row at every width.
 *
 * `now`: an event that has ended by then gets no button (default: the time
 * of rendering), so a list that still shows it never offers to sell it.
 */
export default function QuickBuyLink({
  event,
  className = "",
  fullWidthOnPhones = false,
  narrow = false,
  fill = false,
  now = new Date(),
}: {
  event: SheltuhEvent;
  className?: string;
  fullWidthOnPhones?: boolean;
  narrow?: boolean;
  /** Fill the row at every width (the map card's button row). */
  fill?: boolean;
  now?: Date;
}) {
  const label = quickBuyLabel(event, now);
  if (!label) return null;
  const width = fill
    ? "w-full px-4"
    : narrow
    ? "w-full px-2 text-xs leading-4 sm:w-auto sm:self-start sm:px-4 sm:text-[0.8125rem]"
    : fullWidthOnPhones
      ? "w-full px-4 sm:w-auto"
      : "self-start px-4";
  return (
    <div className={`flex ${className}`.trim()}>
      <Link
        href={quickBuyHref(event)}
        // relative: its visually hidden name is positioned within the button, never the page.
        className={buttonClass("signal", "md", `relative min-h-11 sm:min-h-10 focus-visible:outline-ink ${width}`)}
      >
        {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
        <span className="sr-only">
          {label} for {event.title}
        </span>
        <span aria-hidden="true" className="text-center">
          {label}
        </span>
        <ArrowRightIcon className={`h-4 w-4 shrink-0 ${narrow ? "hidden sm:block" : ""}`.trim()} />
      </Link>
    </div>
  );
}
