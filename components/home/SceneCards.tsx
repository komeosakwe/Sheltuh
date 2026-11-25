"use client";

import Image from "next/image";
import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { sceneData, type SceneData } from "@/lib/home-scenes";
import { categoryHref } from "@/lib/search-suggestions";
import { HOME_CATEGORIES } from "./CategoryRow";
import { COMMUNITY_SCENES } from "./home-content";
import { useOptionalHomeEvents } from "./HomeEventsProvider";

/** The scene list's accessible name. */
export const SCENES_LIST_NAME = "Scenes";
/** The demo's note under the cards: their going counts are the sample events' sample counts. */
export const SCENES_DEMO_NOTE = "This week · Sample counts";

/** Nothing to draw on (outside the home, loading, or the events failed): every card without data. */
const NO_DATA: SceneData = { lead: null, going: null, meta: null };

/**
 * Find your people's three scene cards (the owner's mockup, with real data only): Live music, Art
 * and Pop-ups (COMMUNITY_SCENES), always those three, in that order, loading, loaded or failed. Each
 * card, top to bottom on screen: the photo (4:3, radius 16) of the category's first upcoming event
 * in the home's order, decorative; whenever there's no such photo (no upcoming event, a lead event
 * without one, or the events still loading or failed), the scene's own filler photo
 * (COMMUNITY_SCENES `filler`, a licensed photo on its blurred placeholder), so a card is never a grey
 * tile (owner request, Round 2: this replaces hiding a scene with no events). On the photo, a white
 * tag "N going this week" only with a real count (lib/home-scenes.ts sceneGoing: live, the sum of
 * the server's thresholded counts the page has; demo, the sample counts, with SCENES_DEMO_NOTE
 * under the list). No faces in the tag: the band's portraits are illustration, never attendees, so
 * they stay apart from any count. Then the name (Heading/H3) and "See events" (outlined, small) to
 * /events?category=…, the line, and a mono line ("3 events this month", "No upcoming events") only
 * when the home loaded every upcoming event (sceneMeta).
 *
 * In the DOM the text comes first (the name is the card's heading), the photo after it, shown
 * first. One link per card, "See events" (named with the scene, for a list of links), and its
 * `::after` stretches over the card, so the whole card opens the listing with one tab stop. A
 * labelled list of list items. Phones and tablets: a sideways snap row of 288px cards bleeding to
 * the page's edges (the home's row pattern, so the page never scrolls sideways); from 1024px,
 * three equal columns.
 */
export default function SceneCards({ className = "" }: { className?: string }) {
  const home = useOptionalHomeEvents();
  const state = home?.state;
  const ready = state?.status === "ready" ? state : null;
  const scenes = COMMUNITY_SCENES.map((scene) => {
    const category = HOME_CATEGORIES.find((item) => item.category === scene.category);
    const data =
      home && ready
        ? sceneData(scene.category, { mode: home.mode, events: ready.events, complete: ready.complete, trending: ready.trending, now: ready.now })
        : NO_DATA;
    return { ...scene, label: category?.label ?? scene.category, data };
  });
  const sample = scenes.some(({ data }) => data.going?.sample);

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <ul
        aria-label={SCENES_LIST_NAME}
        data-community-scenes=""
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 py-2 md:-mx-8 md:scroll-px-8 md:px-8 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 lg:py-0"
      >
        {scenes.map(({ category, label, line, filler, data }) => (
          <li key={category} data-community-scene={category} className="group/scene relative flex w-72 shrink-0 snap-start flex-col lg:w-auto lg:min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-4">
              <h3 className="heading-h3 underline-offset-4 group-hover/scene:underline">{label}</h3>
              <ButtonLink
                href={categoryHref(category)}
                variant="outline"
                size="sm"
                data-scene-link=""
                // Named with its scene for a list of links, starting with the visible words (label in name).
                aria-label={`See events: ${label}`}
                // The card's one link: its ::after covers the card (above the photo), so a tap anywhere opens the listing.
                className="after:absolute after:inset-0 after:z-10 after:content-['']"
              >
                See events
              </ButtonLink>
            </div>
            <p className="mt-1 body-m text-muted">{line}</p>
            {data.meta && (
              <p data-scene-meta="" className="mt-2 mono-s text-muted">
                {data.meta}
              </p>
            )}
            <div data-scene-media="" className="relative order-first aspect-[4/3] overflow-hidden rounded-card bg-surface">
              {data.lead?.imageUrl ? (
                <EventArt
                  poster={data.lead.poster}
                  imageUrl={data.lead.imageUrl}
                  imageFocus={data.lead.imageFocus}
                  title={data.lead.title}
                  fit="auto"
                  // As the filler photo beside it: a 288px card in the row, a third of the page from 1024px.
                  sizes="(min-width: 1024px) 33vw, 288px"
                  className="size-full"
                />
              ) : (
                // No lead event photo: the scene's filler, decorative, cropped to fill like a lead photo.
                <span aria-hidden="true" data-scene-filler="" className="absolute inset-0">
                  <Image
                    src={filler.src}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 33vw, 288px"
                    placeholder="blur"
                    blurDataURL={filler.blurDataURL}
                    className="object-cover"
                  />
                </span>
              )}
              {data.going && (
                <p data-scene-going="" className="absolute inset-x-3 bottom-3 flex">
                  <span className="flex min-w-0 items-center gap-2 rounded-badge bg-paper px-3 py-1.5 body-s font-semibold text-ink">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-signal" />
                    <span className="truncate tabular-nums">{data.going.count} going this week</span>
                  </span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {sample && (
        <p data-scenes-note="" className="mt-2 mono-s text-muted lg:mt-4">
          {SCENES_DEMO_NOTE}
        </p>
      )}
    </div>
  );
}
