import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { Scribble } from "@/components/ui/Sticker";
import { HOME_HERO } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** The phone home's cover: eyebrow, a four-line headline beside the hero photo, intro and two CTAs. */
export default function PhoneHero() {
  return (
    <section aria-labelledby="home-title">
      <p className="eyebrow rise mb-3 text-muted">Melbourne · Naarm</p>
      <div className="grid grid-cols-[auto_minmax(5.5rem,1fr)] items-stretch gap-x-3">
        {/* The spaces between spans keep the accessible text a sentence. */}
        <h1
          id="home-title"
          className="rise text-[clamp(2rem,10vw,2.625rem)] leading-[0.9] tracking-[-0.01em] uppercase [--d:80ms]"
        >
          <span className="block">Find your</span> <span className="block">room.</span>{" "}
          <span className="block">Find your</span> <span className="block">people.</span>
        </h1>
        <div className="rise relative [--d:200ms]">
          <EventArt
            poster={HOME_HERO.poster}
            imageUrl={HOME_HERO.imageUrl}
            title="Sheltüh"
            priority
            className="h-full w-full rounded-card"
          />
          <Scribble className="pointer-events-none absolute -inset-2 -rotate-2 text-pop" />
        </div>
      </div>
      <p className="rise mt-4 max-w-[34ch] text-base leading-6 [--d:300ms]">
        Live music, art, workshops and pop-ups, plus the people who make Melbourne’s creative scene.
      </p>
      <div className="rise mt-5 flex flex-col gap-2 [--d:400ms]">
        <ButtonLink href="/events" size="lg" className="w-full">
          Explore events
          <ArrowRightIcon />
        </ButtonLink>
        <ButtonLink href="#find-your-people" variant="outline" size="lg" className="w-full">
          Join the community
        </ButtonLink>
      </div>
    </section>
  );
}
