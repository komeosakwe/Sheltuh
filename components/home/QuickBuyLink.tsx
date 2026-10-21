import Link from "next/link";
import { quickBuyLabel } from "@/lib/quick-buy";
import type { SheltuhEvent } from "@/lib/types";
import { ArrowRightIcon } from "./icons";

/**
 * A card's "Get tickets" link (docs/design/brand-direction-one.md §6.6):
 * a sibling of the card's main link, straight to the event page's ticket
 * section. Quiet on purpose (black, underlined, never orange). Renders
 * nothing when there's nothing to get yet.
 */
export default function QuickBuyLink({
  event,
  mode,
  className = "",
}: {
  event: SheltuhEvent;
  mode: "demo" | "live";
  className?: string;
}) {
  const label = quickBuyLabel(event, mode);
  if (!label) return null;
  return (
    <Link
      href={`/events/${event.slug}#tickets`}
      className={`-ml-0.5 inline-flex min-h-11 items-center gap-1 self-start px-0.5 text-sm leading-5 font-semibold underline decoration-1 underline-offset-4 ${className}`.trim()}
    >
      {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
      <span className="sr-only">
        {label} for {event.title}
      </span>
      <span aria-hidden="true">{label}</span>
      <ArrowRightIcon />
    </Link>
  );
}
