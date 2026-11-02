import Link from "next/link";
import EventArt from "@/components/EventArt";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The phone home's one event entry (below 640px, in place of the rails):
 * a big card (ringed when its link has the keyboard focus) with the first upcoming event's photo, "Swipe through events"
 * and how many there are, linking to the swipe feed (/swipe). The link is the
 * title's, stretched over the card; the count is read after it. White text on
 * a gradient that is solid black at the foot, so it passes WCAG AA on any photo.
 */
export default function HomeSwipeEntry({ events }: { events: SheltuhEvent[] }) {
  const first = events[0];
  if (!first) return null;
  return (
    <div
      data-swipe-entry=""
      className="relative aspect-square overflow-hidden rounded-card bg-ink text-paper has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-foreground"
    >
      <div className="absolute inset-0">
        <EventArt
          poster={first.poster}
          imageUrl={first.imageUrl}
          imageFocus={first.imageFocus}
          title={first.title}
          className="h-full w-full"
        />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-ink from-30% via-ink/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="text-2xl leading-8 font-bold tracking-[-0.02em]">
            <Link href="/swipe" className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-hidden">
              Swipe through events
            </Link>
          </h2>
          <p data-swipe-count="" className="mt-1 text-base leading-6 font-semibold">
            {events.length} {events.length === 1 ? "event" : "events"}
          </p>
        </div>
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-control bg-signal text-signal-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
            <path d="m6 15 6-6 6 6" />
          </svg>
        </span>
      </div>
    </div>
  );
}
