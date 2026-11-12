"use client";

import Image from "next/image";
import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import EventArt from "@/components/EventArt";
import HomeSectionHead from "@/components/home/HomeSectionHead";
import { useLocationModule } from "@/components/search/useLocationModule";
import { cityScenes, COMMUNITY_CITIES, type CityScene, type CommunityCity } from "@/lib/community";
import { resolveEventCoordinates } from "@/lib/geo";
import { writeStoredNear } from "@/lib/near-storage";
import { useCommunityEvents } from "./CommunityEventsProvider";
import { SCENES_PHOTO, SCENES_TITLE } from "./community-content";

/**
 * "Scenes by city" (the proposal, redesign PR 3), from real data: each of the proposal's five
 * cities is a link to Nearby set to that city (it becomes the visitor's remembered place, as the
 * location menu's Suggested places do, so Nearby centres on it and lists what's nearest first),
 * with the categories of its upcoming events and how many there are within CITY_RADIUS_KM
 * (lib/community.ts), and the soonest one's art as its thumbnail. Counts show only once every
 * event is placed (events without a venue pin need the suburb table, loaded on demand as /map
 * does) and only when the page read every upcoming event; otherwise the cities show without
 * them. From 1024px a licensed photo of Melbourne sits beside the list (decorative). No members,
 * scenes or follows: those wait for Batch 3. `#scenes-by-city` (the hero's "Explore scenes")
 * lands here.
 */
export default function ScenesByCity({ className = "" }: { className?: string }) {
  const { state } = useCommunityEvents();
  const events = state.status === "ready" ? state.feed.events : [];
  const needsTable = events.some((event) => !event.coordinates);
  const { module, failed } = useLocationModule(needsTable);
  const placeable = state.status === "ready" && (!needsTable || module !== null);
  const scenes: CityScene[] | null = placeable
    ? cityScenes(events, (event) => resolveEventCoordinates(event, (query) => module?.findLocality(query) ?? null))
    : null;
  const counted = scenes !== null && state.status === "ready" && state.feed.complete;

  function choose(city: CommunityCity) {
    // The suburb table's own name for it where it has loaded ("Brisbane City"), as the location menu stores.
    const place = module?.findLocality(city.name);
    writeStoredNear(place?.name ?? city.name, place?.state ?? city.state);
  }

  return (
    <section id="scenes-by-city" aria-labelledby="community-scenes" tabIndex={-1} className={`focus:outline-none ${className}`.trim()}>
      <HomeSectionHead id="community-scenes" title={SCENES_TITLE} />
      <div className="lg:grid lg:grid-cols-12 lg:gap-8">
        <div aria-hidden="true" className="relative hidden overflow-hidden rounded-card bg-surface lg:col-span-7 lg:block">
          <Image src={SCENES_PHOTO.src} alt="" fill sizes="(min-width: 1440px) 740px, 58vw" className="object-cover" />
        </div>
        <ul className="lg:col-span-5">
          {COMMUNITY_CITIES.map((city, i) => {
            const scene = scenes?.[i];
            const lead = scene?.events[0];
            const parts = [
              ...(scene?.categories ?? []),
              ...(counted && scene ? [scene.events.length > 0 ? `${scene.events.length} upcoming` : "No upcoming events"] : []),
            ];
            return (
              <li key={city.name} className="border-t border-surface-border last:border-b">
                <Link
                  href="/map"
                  onClick={() => choose(city)}
                  data-city={city.name}
                  className="group/city flex min-h-24 items-center gap-4 py-4 hover:bg-hover"
                >
                  <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface">
                    {lead ? (
                      <EventArt poster={lead.poster} imageUrl={lead.imageUrl} imageFocus={lead.imageFocus} title="" className="size-full" />
                    ) : (
                      <DotsMark size="sm" className="text-muted" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="heading-h3 underline-offset-4 group-hover/city:underline">{city.name}</span>
                    {parts.length > 0 && <span className="mono-s text-muted uppercase">{parts.join(" · ")}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {failed && needsTable && (
        <p className="mt-4 body-s text-muted">Event counts aren’t available right now.</p>
      )}
    </section>
  );
}
