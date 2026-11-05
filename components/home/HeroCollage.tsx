import EventArt from "@/components/EventArt";
import HeroBadge from "./HeroBadge";
import { HOME_HERO } from "./home-content";

/**
 * The desktop hero's photo (compacted at the owner's request, 4 Nov 2026:
 * "hero and search bar take too much of the screen"; it was a tall collage
 * of three photos, an asterisk and a badge about 500px high): the lead
 * photo as a short landscape tile, the round "Melbourne · Naarm · Curated"
 * badge turning slowly over its left edge (`HeroBadge`: pausable, still
 * under reduced motion). From 1024px only (the caller hides it below): on
 * phones the hero stays short, so the first event shows on the first screen.
 * The photo is decoration (the hero's words carry the message) and keeps its
 * one-off push-in (`motion`, reduced-motion safe). The box has a fixed
 * size, so nothing shifts as the photo loads.
 */
export default function HeroCollage({ className = "" }: { className?: string }) {
  return (
    <div data-hero-collage="" className={`relative aspect-[4/3] w-52 xl:w-60 ${className}`.trim()}>
      <div aria-hidden="true" className="size-full">
        <EventArt
          poster={HOME_HERO.poster}
          imageUrl={HOME_HERO.imageUrl}
          title="Sheltüh"
          priority="when-shown"
          motion
          className="size-full rounded-card"
        />
      </div>
      <HeroBadge className="absolute -top-3 -left-6 size-20" />
    </div>
  );
}
