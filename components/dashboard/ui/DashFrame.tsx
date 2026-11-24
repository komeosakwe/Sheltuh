"use client";

import type { ReactNode } from "react";
import { DashFrameContext, type DashArea } from "./DashFrameContext";

export type { DashArea };

/**
 * The main column's inline padding (16 on phones, 24 on tablets, 48 left / 40 right on a desktop),
 * and the negative margins that take something back out to the column's edges (the event editor's
 * save bar, EditorBar). Whole class names, so Tailwind finds them here.
 */
export const DASH_MAIN_INLINE = "px-4 md:px-6 lg:pr-10 lg:pl-12";
export const DASH_MAIN_BLEED = "-mx-4 md:-mx-6 lg:-mr-10 lg:-ml-12";

/**
 * The body's padding on a tablet: 24 above the panel in both; at its sides 24 (the customer 1120 frames) or
 * 32 (the organiser frames, 492:14153 and 492:14821); below it 32 (customer) or 48 (organiser).
 */
const BODY: Record<DashArea, string> = {
  account: "md:px-6 md:pb-8",
  organiser: "md:px-8 md:pb-12",
};

/**
 * The account areas' shared frame ("Dash = shared" in Latte's frames: the customer account
 * 1120 frames and the organiser dashboard frames, KEY-SPECS §1–2): the page on surface/muted, a
 * white panel ("Shell") holding the page, and the way between the area's pages.
 *
 * - Desktop (from 1024px): the panel is rounded (16), at least 960px tall, 32px below the header
 *   and 64px above the footer, 64px in from the sides from 1280px (32px below that) and up to
 *   1312px wide; `sidebar` (the 264px black column) on its left, the page on the right with 56px
 *   above it, 40px right and below, 48px left.
 * - Tablet (768–1023px): the panel is rounded, 24px below the header, 24px in at the sides for the
 *   customer area and 32 for the organiser's (below it 32 and 48). `top` runs across its top (the customer's tabs row),
 *   `rail` down its left (the organiser's 64px black rail), and 24px around the page.
 * - Phones: the panel is full-bleed with no radius, `top` or `rail` as on a tablet, 24px above and
 *   below the page and 16px at the sides.
 *
 * Pages stack their parts 24px apart (the frames' Main gap). `sidebar` hides itself below 1024px
 * and `rail` / `top` from it. What's inside can tell it's framed (useDashFrame).
 *
 * `bare`: no frame, just the page (the organiser area for someone who isn't an approved organiser
 * yet, and its full-screen pages). The same elements stay, drawn as `display: contents` with no
 * data attributes, so the page keeps its place in the tree and isn't remounted (losing its state)
 * when the frame comes or goes: an organiser's record loading after the page, say.
 */
export default function DashFrame({
  area,
  sidebar,
  rail,
  top,
  bare = false,
  children,
}: {
  area: DashArea;
  sidebar: ReactNode;
  rail?: ReactNode;
  top?: ReactNode;
  bare?: boolean;
  children: ReactNode;
}) {
  const part = (name: string, className: string) =>
    bare ? { className: "contents" } : { [`data-${area}-${name}`]: "", className };
  return (
    <div {...part("body", `bg-surface md:pt-6 ${BODY[area]} lg:px-8 lg:pt-8 lg:pb-16 xl:px-16`)}>
      <div {...part("shell", "flex overflow-clip bg-background md:rounded-card lg:mx-auto lg:min-h-240 lg:max-w-328")}>
        {bare ? null : sidebar}
        {bare ? null : rail}
        <div className={bare ? "contents" : "flex min-w-0 flex-1 flex-col"}>
          {bare ? null : top}
          {/* The skip link's target (components/SkipLink.tsx): past the sidebar, straight to the page. */}
          <div
            {...part("main", `flex min-w-0 flex-1 flex-col gap-6 py-6 focus:outline-none lg:pt-14 lg:pb-10 ${DASH_MAIN_INLINE}`)}
            {...(bare ? {} : { "data-skip-target": "", tabIndex: -1 })}
          >
            <DashFrameContext.Provider value={bare ? null : area}>{children}</DashFrameContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
