"use client";

import Image from "next/image";
import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import EventArt from "@/components/EventArt";
import HomeSectionHead from "@/components/home/HomeSectionHead";
import { useLocationModule } from "@/components/search/useLocationModule";
import { cityScenes, COMMUNITY_CITIES, type CityScenes } from "@/lib/community";
import { resolveEventCoordinates } from "@/lib/geo";
import { useCommunityEvents } from "./CommunityEventsProvider";
import { SCENES_PHOTO, SCENES_TITLE } from "./community-content";

/** Where a city's link goes: Nearby, asked to look around that city (/map reads `near` from redesign PR 5). */
export function nearbyHref(city: string): string {
  return `/map?near=${encodeURIComponent(city)}`;
}

/**
 * "Scenes by city" (the proposal, redesign PR 3), from real data: each of the proposal's five
 * cities is a link to Nearby around that city (`/map?near=…`; it never changes the visitor's
 * remembered place), named "Events near {city} on Nearby", with the categories of its upcoming
 * events, how many there are within 25 km (lib/community.ts) and the soonest one's art as its
 * 96px thumbnail. Counts show only when the page read every upcoming event and placed every one
 * (events without a venue pin need the suburb table, loaded on demand as /map does); otherwise
 * the cities show without them, and if the table can't load, a line says so. A licensed photo of
 * Melbourne leads the section: above the list on phones, beside it from 1024px (decorative). No
 * members, scenes or follows: those wait for Batch 3. `#scenes-by-city` (the hero's "Explore
 * scenes") lands here, focus included.
 */
export default function ScenesByCity({ className = "" }: { className?: string }) {
  const { state } = useCommunityEvents();
  const events = state.status === "ready" ? state.feed.events : [];
  const needsTable = events.some((event) => !event.coordinates);
  const { module, failed } = useLocationModule(needsTable);
  const placeable = state.status === "ready" && (!needsTable || module !== null);
  const result: CityScenes | null = placeable
    ? cityScenes(events, (event) => resolveEventCoordinates(event, (query) => module?.findLocality(query) ?? null))
    : null;
  const counted = result !== null && result.allPlaced && state.status === "ready" && state.feed.complete;

  return (
    <section id="scenes-by-city" aria-labelledby="community-scenes" tabIndex={-1} className={`focus:outline-none ${className}`.trim()}>
      <HomeSectionHead id="community-scenes" title={SCENES_TITLE} />
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div aria-hidden="true" className="relative aspect-[5/4] overflow-hidden rounded-card bg-surface lg:col-span-7">
          <Image src={SCENES_PHOTO.src} alt="" fill sizes="(min-width: 1440px) 760px, (min-width: 1024px) 58vw, 100vw" className="object-cover" />
        </div>
        <ul className="lg:col-span-5">
          {COMMUNITY_CITIES.map((city, i) => {
            const scene = result?.scenes[i];
            const lead = scene?.events[0];
            const parts = [
              ...(scene?.categories ?? []),
              ...(counted && scene ? [scene.events.length > 0 ? `${scene.events.length} upcoming` : "No upcoming events"] : []),
            ];
            const lineId = `city-${city.name.toLowerCase()}-line`;
            return (
              <li key={city.name} className="border-t border-surface-border last:border-b">
                <Link
                  href={nearbyHref(city.name)}
                  aria-label={`Events near ${city.name} on Nearby`}
                  aria-describedby={parts.length > 0 ? lineId : undefined}
                  data-city={city.name}
                  className="group/city flex min-h-36 items-center gap-6 py-6 hover:bg-hover"
                >
                  <span aria-hidden="true" className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface">
                    {lead ? (
                      <EventArt poster={lead.poster} imageUrl={lead.imageUrl} imageFocus={lead.imageFocus} title="" className="size-full" />
                    ) : (
                      <DotsMark size="md" className="text-muted" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-2">
                    <span className="heading-h1 underline-offset-4 group-hover/city:underline">{city.name}</span>
                    {parts.length > 0 && (
                      <span id={lineId} className="mono-s text-muted">
                        {parts.join(" · ")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {failed && needsTable && <p className="mt-4 body-s text-muted">Event counts aren’t available right now.</p>}
    </section>
  );
}
