"use client";

import { useEffect, useRef, useState } from "react";
import EventArt from "@/components/EventArt";
import { HOME_WHAT_ELSE } from "./home-content";

/**
 * The band at the middle of the viewport where an item takes the highlight:
 * as you scroll, each one lights up in turn as it crosses the middle.
 */
const MIDDLE_BAND = "-45% 0px -45% 0px";

/**
 * "What else?" (restored from the original home at the owner's request,
 * 23 Oct 2026; docs/design/mobile-redesign.md, owner round): a big
 * uppercase h2 and three promises, each an h3, beside a
 * tall photo from 1024px. One item at a time is in full black: the first at
 * load, then whichever crosses the middle of the screen as you scroll (or
 * is under the pointer), and the photo changes to that item's. The others
 * stay readable in the muted text colour (5.65:1 on white), never faded
 * out: nothing waits for a scroll to be legible. The photo cross-fade and
 * the colour change ease only for people who haven't asked for less motion.
 * The photo is decoration (hidden below 1024px, where it would cost a phone
 * screen before the list).
 */
export default function WhatElse({ className = "" }: { className?: string }) {
  // What the scroll picked and what the pointer is over, kept apart so the scroll's
  // choice comes back when the pointer leaves.
  const [scrolled, setScrolled] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? scrolled;
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = items.current.indexOf(entry.target as HTMLLIElement);
          if (index >= 0) setScrolled(index);
        }
      },
      { rootMargin: MIDDLE_BAND },
    );
    for (const item of items.current) if (item) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-labelledby="home-what-else" data-what-else="" className={`lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-8 ${className}`.trim()}>
      <div aria-hidden="true" className="relative hidden aspect-[4/5] lg:col-span-5 lg:block">
        {HOME_WHAT_ELSE.map((item, index) => (
          <div
            key={item.title}
            data-what-else-photo={index === active ? "active" : ""}
            className={`absolute inset-0 motion-safe:transition-opacity motion-safe:duration-500 ${index === active ? "opacity-100" : "opacity-0"}`}
          >
            <EventArt poster={item.poster} imageUrl={item.imageUrl} title="Sheltüh" className="size-full rounded-card" />
          </div>
        ))}
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <h2 id="home-what-else" className="display-lg display-plain">
          What else?
        </h2>
        <ul className="mt-6 flex flex-col gap-6 sm:mt-8 sm:gap-8">
          {HOME_WHAT_ELSE.map((item, index) => (
            <li
              key={item.title}
              ref={(el) => {
                items.current[index] = el;
              }}
              data-active={index === active ? "true" : "false"}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              className={`motion-safe:transition-colors motion-safe:duration-300 ${index === active ? "text-foreground" : "text-muted"}`}
            >
              <h3 className="text-xl leading-6 font-bold tracking-tight uppercase sm:text-2xl sm:leading-7">{item.title}</h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
