import EventArt from "@/components/EventArt";
import HeroBadge from "./HeroBadge";
import { HOME_HERO, HOME_HERO_TILES } from "./home-content";

/** The black asterisk at the collage's top-right corner (the original's sticker mark). Decorative. */
function Asterisk({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <g stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        <line x1="50" y1="8" x2="50" y2="92" />
        <line x1="8" y1="50" x2="92" y2="50" />
        <line x1="20" y1="20" x2="80" y2="80" />
        <line x1="80" y1="20" x2="20" y2="80" />
      </g>
    </svg>
  );
}

/**
 * The desktop hero's photo collage (restored from the original home at the
 * owner's request, 23 Oct 2026: "keep this as well and the motion in the
 * picture"): a tall lead photo with two smaller ones overlapping its foot,
 * the round "Melbourne · Naarm · Curated" badge turning slowly over its
 * left edge (`HeroBadge`: pausable, still under reduced motion) and a black
 * asterisk at the top right. From 1024px only (the caller hides it below):
 * on phones the hero stays short, so the first event shows on the first
 * screen. The photos are decoration (the hero's words carry the message);
 * the lead keeps its one-off push-in (`motion`, reduced-motion safe), the
 * original's endless floating is left out. Gaps between the photos are the
 * page's own background (`border-background`), so the collage follows the
 * site's colour.
 */
export default function HeroCollage({ className = "" }: { className?: string }) {
  const [left, right] = HOME_HERO_TILES;
  return (
    <div data-hero-collage="" className={`relative aspect-[5/4] ${className}`.trim()}>
      <div aria-hidden="true">
        {/* Each photo in a positioned box: EventArt is itself `relative`. */}
        <div className="absolute top-0 right-0 h-4/5 w-4/5">
          <EventArt
            poster={HOME_HERO.poster}
            imageUrl={HOME_HERO.imageUrl}
            title="Sheltüh"
            priority="when-shown"
            motion
            className="size-full rounded-card"
          />
        </div>
        <div className="absolute bottom-0 left-0 h-2/5 w-1/2">
          <EventArt poster={left.poster} imageUrl={left.imageUrl} title="Sheltüh" className="size-full rounded-card border-4 border-background" />
        </div>
        <div className="absolute right-0 bottom-0 h-1/3 w-2/5">
          <EventArt poster={right.poster} imageUrl={right.imageUrl} title="Sheltüh" className="size-full rounded-card border-4 border-background" />
        </div>
        <Asterisk className="absolute -top-3 -right-2 size-10 text-foreground" />
      </div>
      <HeroBadge className="absolute top-12 left-0 size-28" />
    </div>
  );
}
