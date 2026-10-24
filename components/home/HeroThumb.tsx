import EventArt from "@/components/EventArt";
import HeroBadge from "./HeroBadge";
import { HOME_HERO } from "./home-content";

/**
 * The hero's small photo beside the headline below 1024px (owner, 24 Oct
 * 2026, on the phone hero's empty space: "little image should be there"):
 * the desktop collage's lead photo (`HOME_HERO`) as a rounded square tile,
 * 72px at 320, 88px from 375 and 112px from 640, each no taller than the
 * eyebrow and the h1 beside it, so the hero is no taller and the first event
 * still reaches a phone's first screen. The caller hides it from 1024px,
 * where the full collage shows; a hidden lazy image is never fetched.
 *
 * A still copy of the collage's round badge overlaps its top-right corner.
 * Still, and not a control: at this size it couldn't be a 44px Pause/Play
 * target, and moving content needs one (WCAG 2.2.2). Decorative throughout
 * (`aria-hidden`, the photo's `alt=""`): the headline carries the message.
 */
export default function HeroThumb({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-hero-thumb=""
      className={`relative size-18 shrink-0 min-[375px]:size-22 sm:size-28 ${className}`.trim()}
    >
      <EventArt
        poster={HOME_HERO.poster}
        imageUrl={HOME_HERO.imageUrl}
        title="Sheltüh"
        priority="when-shown"
        className="size-full rounded-card"
      />
      <HeroBadge still className="absolute -top-2 -right-2 size-9 sm:size-11" />
    </div>
  );
}
