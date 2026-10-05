"use client";

import { useEffect, useState, type ReactNode } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { loadHomeEvents } from "@/lib/home-events";
import { selectHomeSections, type HomeSections } from "@/lib/home-sections";
import FeaturedEventCard, { FeaturedEventCardPlaceholder } from "./FeaturedEventCard";
import HomeEventCard, { HomeEventCardPlaceholder } from "./HomeEventCard";
import PhoneRail, { PhoneRailItem } from "./PhoneRail";
import SectionHead from "./SectionHead";
import { useIsPhone } from "./useIsPhone";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; sections: HomeSections };

/**
 * The phone home's event sections: Up next, Coming up, What's on, then the
 * static `guide` slot, then Free & low-cost. Events come from the same shared
 * loader as the desktop preview (one request set for both). Cards render only
 * on a phone, so wider screens (where this whole tree is hidden) pay no DOM cost.
 */
export default function PhoneEventSections({ guide }: { guide?: ReactNode }) {
  const mode = isApiConfigured ? "live" : "demo";
  const phone = useIsPhone();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadHomeEvents().then(
      (events) => {
        if (!cancelled) setState({ status: "ready", sections: selectHomeSections(events, new Date()) });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  const sections = state.status === "ready" ? state.sections : null;
  const loading = state.status === "loading";

  return (
    <>
      {/* Always mounted so "Loading events…" is announced. */}
      <p role="status" className="sr-only">
        {loading ? "Loading events…" : ""}
      </p>

      {mode === "demo" && (
        <div className="mt-6">
          <DemoNotice>Sample listings, nothing here is a real booking.</DemoNotice>
        </div>
      )}

      <section aria-labelledby="home-next" className="reveal mt-6">
        <h2 id="home-next" className="sr-only">
          Up next
        </h2>
        {loading && <FeaturedEventCardPlaceholder />}
        {state.status === "error" && (
          <>
            <Notice tone="danger" role="alert">
              Couldn’t load events.
            </Notice>
            <Button variant="outline" size="lg" className="mt-3" onClick={retry}>
              Try again
            </Button>
          </>
        )}
        {sections && !sections.featured && (
          <p className="text-sm text-muted">No events have been published yet. Check back soon.</p>
        )}
        {sections?.featured && phone && <FeaturedEventCard event={sections.featured} mode={mode} />}
      </section>

      {(loading || (sections && sections.comingUp.length > 0)) && (
        <section aria-labelledby="home-coming" className="reveal mt-8">
          <SectionHead
            id="home-coming"
            title="Coming up in Melbourne"
            seeAll={{ href: "/events", srLabel: "events" }}
          />
          {loading ? (
            <div aria-hidden="true" className="-mx-5 -my-4 flex gap-3 overflow-hidden px-5 py-4">
              <HomeEventCardPlaceholder />
              <HomeEventCardPlaceholder />
            </div>
          ) : (
            phone &&
            sections && (
              <PhoneRail labelledBy="home-coming">
                {sections.comingUp.map((event) => (
                  <PhoneRailItem key={event.id}>
                    <HomeEventCard event={event} variant="standard" mode={mode} />
                  </PhoneRailItem>
                ))}
              </PhoneRail>
            )
          )}
        </section>
      )}

      {sections && sections.month.items.length > 0 && (
        <section aria-labelledby="home-month" className="reveal mt-8">
          <SectionHead id="home-month" title={sections.month.title} seeAll={{ href: "/events", srLabel: "events" }} />
          {phone && (
            <PhoneRail labelledBy="home-month">
              {sections.month.items.map((event) => (
                <PhoneRailItem key={event.id}>
                  <HomeEventCard event={event} variant="wide" mode={mode} />
                </PhoneRailItem>
              ))}
            </PhoneRail>
          )}
        </section>
      )}

      {guide}

      {sections && sections.lowCost.length > 0 && (
        <section aria-labelledby="home-free" className="reveal mt-8">
          <SectionHead
            id="home-free"
            title="Free & low-cost"
            seeAll={{ href: "/events?pricing=free", srLabel: "free events" }}
          />
          {phone && (
            <PhoneRail labelledBy="home-free">
              {sections.lowCost.map(({ event, badge }) => (
                <PhoneRailItem key={event.id}>
                  <HomeEventCard event={event} variant="compact" mode={mode} badge={badge} />
                </PhoneRailItem>
              ))}
            </PhoneRail>
          )}
        </section>
      )}
    </>
  );
}
