import Image from "next/image";
import BrandU from "@/components/brand/BrandU";
import DotsMark from "@/components/brand/DotsMark";
import { buttonClass, ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/home/icons";
import { COMMUNITY_COLLAGE, COMMUNITY_LEDE, COMMUNITY_TITLE, COMMUNITY_TITLE_LINES } from "./community-content";
import SignedOutOnly from "./SignedOutOnly";

/** The collage's tilts, in turn: small, so the photos read as pinned up, not as motion. */
const TILTS = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2"] as const;

/**
 * /community's hero (the proposal, redesign PR 3): two staggered rows of licensed photos across the
 * top (decorative, white-framed and slightly tilted, as drawn, each photo once; it never moves), then the eyebrow,
 * the h1 FIND YOÜR / PEOPLE. in Display (read "Find your people."), and beside it from 1024px
 * the lede with "Explore scenes" (to Scenes by city, below) and "Join free" (sign up; not shown
 * to members).
 */
export default function CommunityHero() {
  const [first, second] = COMMUNITY_TITLE_LINES;
  return (
    <section aria-labelledby="community-title">
      {/* Two rows, the second set half a photo along, overflowing both edges (clipped, never scrolled). */}
      <div aria-hidden="true" data-community-collage="" className="flex flex-col items-center gap-3 overflow-hidden py-4 md:gap-4 md:py-6">
        {COMMUNITY_COLLAGE.map((row, r) => (
          <div key={r} className={`flex gap-4 md:gap-6 ${r === 1 ? "translate-x-16 md:translate-x-28" : ""}`.trim()}>
            {row.map((photo, i) => (
              <div
                key={photo.src}
                className={`relative h-28 shrink-0 overflow-hidden border-4 border-paper bg-surface md:h-40 lg:h-48 ${
                  photo.width === photo.height ? "aspect-square" : "aspect-[4/3]"
                } ${TILTS[(i + r) % TILTS.length]}`}
              >
                <Image
                  src={photo.src}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 256px, (min-width: 768px) 214px, 150px"
                  priority={r === 0 && i < 3}
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="page-container mt-8 md:mt-12 lg:grid lg:grid-cols-12 lg:items-end lg:gap-8">
        <div className="lg:col-span-7">
          <p className="eyebrow flex items-center gap-2">
            <DotsMark size="xs" className="text-signal" />
            Community
          </p>
          <h1 id="community-title" className="mt-4 display-l lg:display-xl">
            <BrandU spoken={COMMUNITY_TITLE}>
              <span className="block">{first}</span> <span className="block">{second}</span>
            </BrandU>
          </h1>
        </div>
        <div className="mt-6 lg:col-span-5 lg:mt-0">
          <p className="body-l text-muted">{COMMUNITY_LEDE}</p>
          <div className="mt-6 flex flex-wrap gap-4">
            {/* A plain in-page link (not a client navigation), so the browser moves focus to the section. */}
            <a href="#scenes-by-city" className={buttonClass("signal")}>
              Explore scenes
              <ArrowRightIcon className="size-4 shrink-0" />
            </a>
            <SignedOutOnly>
              <ButtonLink href="/signup" variant="outline">
                Join free
              </ButtonLink>
            </SignedOutOnly>
          </div>
        </div>
      </div>
    </section>
  );
}
