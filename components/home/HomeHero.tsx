import DotsMark from "@/components/brand/DotsMark";
import SearchBar from "@/components/SearchBar";
import HeroCollage from "./HeroCollage";
import HeroThumb from "./HeroThumb";
import { HOME_INTRO, HOME_TITLE_LINES, titleParts } from "./home-content";

/**
 * One line of the h1: plain text, with its marked letters (`HOME_TITLE_LINES`)
 * in the dotted face. No whitespace between the runs, so the line's text is
 * exactly the plain words.
 */
function TitleLine({ line }: { line: string }) {
  return (
    <span className="block">
      {titleParts(line).map((part, i) =>
        part.dotted ? (
          <span key={i} data-dotted-letter="" className="font-dots">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}

/**
 * The home's hero (docs/design/mobile-redesign.md §6.1 and its Refinement,
 * 22 Oct 2026): one message, kept short so the first event's image and title
 * come up on a phone's first screen. The eyebrow (the page's one use of the
 * brand dots), the h1 "Find your next thing." (the site's one heavy
 * uppercase display line; two lines at every width, each free to wrap at
 * large text sizes: never `nowrap`), one short muted sentence (at every
 * width, one line on a phone), then the search,
 * the page's only search on the home (the header leaves its own out here).
 * The category row under it is the way to browse. Nothing animates in.
 *
 * The h1 is in the plain face but for two letters in the dotted one,
 * FIND YOÜR NEXT THÏNG. (owner, 24 Oct 2026: "only two letters with dots";
 * the letters are chosen in `HOME_TITLE_LINES`).
 *
 * The photo collage (`HeroCollage`, with its slowly turning badge) shows from
 * 1024px only, beside the text; its lead photo is lazy (a hidden image is
 * never fetched) with a high fetch priority where it shows. Below 1024px the
 * same photo is a small tile beside the eyebrow and h1 (`HeroThumb`, owner,
 * 24 Oct 2026), no taller than them, so the first event still reaches a
 * phone's first screen.
 */
export default function HomeHero() {
  const [first, second] = HOME_TITLE_LINES;
  return (
    <section aria-labelledby="home-title" className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-8">
      <div className="lg:col-span-7">
        {/* The tile takes a fixed column at the right, so the h1's two lines keep their own width. */}
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow flex items-center gap-2 text-muted">
              <DotsMark size="xs" className="text-signal" />
              What’s on near you
            </p>
            <h1 id="home-title" className="display-lg mt-2 font-display display-plain sm:mt-3">
              {/* The literal space keeps the accessible name "Find your next thing.". */}
              <TitleLine line={first} /> <TitleLine line={second} />
            </h1>
          </div>
          <HeroThumb className="lg:hidden" />
        </div>
        {/* At every width (owner, 23 Oct 2026, layout polish), close under the headline on phones. */}
        <p className="mt-2 max-w-[40ch] text-base leading-6 text-muted sm:mt-3 sm:text-lg sm:leading-7">{HOME_INTRO}</p>
        {/* Search is the hero's main action: full width on phones, a comfortable field from 640px. */}
        <div className="mt-4 sm:mt-5 sm:max-w-xl">
          <SearchBar size="lg" submit label="Search events" placeholder="Search events" />
        </div>
      </div>
      <HeroCollage className="hidden lg:col-span-5 lg:col-start-8 lg:block" />
    </section>
  );
}
