import Image from "next/image";
import Strap from "@/components/ui/Strap";
import { buttonClass } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/home/icons";
import {
  HOW_IT_WORKS_ID,
  ORGANISERS_EYEBROW,
  ORGANISERS_HERO_PHOTO,
  ORGANISERS_LEDE,
  ORGANISERS_TITLE_LINES,
  START_ID,
} from "./organisers-content";

/**
 * The For organisers hero (the owner's mock, redesign PR 6): a black panel with the eyebrow, the
 * h1 "Your event. Your community." in Display (Bootzy, in capitals, as Community's h1), the lede,
 * "Get started" (the page's one orange action, to the Start organising panel) and "See how it
 * works" (to the four steps), and a licensed photo, inset 16px from the panel's right edge. Full
 * width under the header on phones and tablets, a rounded panel inside the page margins from
 * 1024px. In Dark the panel lifts off the black page (data-ink-lift, globals.css: the --hover
 * fill). Plain in-page links, so the browser moves focus with the scroll.
 */
export default function OrganisersHero() {
  const [first, second] = ORGANISERS_TITLE_LINES;
  return (
    <div className="lg:page-container lg:pt-8">
      <section
        aria-labelledby="organisers-title"
        data-surface="ink"
        data-ink-lift=""
        className="overflow-hidden lg:rounded-card"
      >
        <div className="px-4 py-12 md:px-8 md:py-16 lg:grid lg:grid-cols-2 lg:items-center lg:gap-12 lg:py-16 lg:pr-4 lg:pl-16">
          <div className="min-w-0">
            <Strap label={ORGANISERS_EYEBROW} rule={false} className="text-signal" />
            <h1 id="organisers-title" className="mt-6 display-l break-words">
              <span className="block">{first}</span> <span className="block">{second}</span>
            </h1>
            <p className="mt-6 body-l font-medium">{ORGANISERS_LEDE}</p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <a href={`#${START_ID}`} className={buttonClass("signal", "md", "w-full sm:w-auto")}>
                Get started
                <ArrowRightIcon className="size-4 shrink-0" />
              </a>
              <a href={`#${HOW_IT_WORKS_ID}`} className={buttonClass("outline", "md", "w-full sm:w-auto")}>
                See how it works
              </a>
            </div>
          </div>
          <div className="relative mt-12 aspect-4/3 overflow-hidden rounded-card bg-surface lg:mt-0">
            <Image
              src={ORGANISERS_HERO_PHOTO}
              alt=""
              fill
              preload
              sizes="(min-width: 1440px) 600px, (min-width: 1024px) 42vw, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
