import Link from "next/link";
import { ArrowRightIcon } from "@/components/home/icons";
import { PANEL_LINE, WHO_SEES_YOU } from "./community-content";

type PointIcon = (typeof WHO_SEES_YOU.points)[number]["icon"];

/** Line icons for the three points (decorative: each point's text says it). */
function Icon({ kind }: { kind: PointIcon }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6 shrink-0 lg:size-8"
    >
      {kind === "people" && (
        <>
          <circle cx="9" cy="8" r="3.25" />
          <path d="M3.5 19.5c0-3 2.5-5.25 5.5-5.25s5.5 2.25 5.5 5.25" />
          <path d="M15.5 4.9a3.25 3.25 0 0 1 0 6.2M17.5 14.6c1.9.6 3 2.4 3 4.9" />
        </>
      )}
      {kind === "eye" && (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {kind === "message" && <path d="M4 5.5h16v10.5H9.5L5 19.5V16H4Z" />}
    </svg>
  );
}

/**
 * "Your visibility, your choice" (the owner's newer card, 13 Nov 2026, replacing the proposal's
 * "You choose who sees you" panel): its title and line, then three plain points with line icons in
 * a white card, and "How Who's going works", the full rules in the Privacy Policy. A cream panel
 * (--hover), as Local discovery's. Text only: opting in happens on an event's page, with a ticket.
 *
 * Its content is set large to fill the panel (owner, "make this bigger", 13 Nov 2026): from 1024px
 * the panel is as tall as Local discovery beside it (the grid row stretches), so the heading and
 * line step up a size, the points' card grows to take the height left (its points spread evenly,
 * body-l with 24px icons) and the link is body-l. Phones keep the compact sizes.
 */
export default function WhoSeesYou({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="community-who" className={`flex flex-col rounded-card bg-hover p-6 md:p-8 lg:p-12 ${className}`.trim()}>
      <h2 id="community-who" className="heading-h1 lg:text-5xl lg:leading-tight">
        {WHO_SEES_YOU.title}
      </h2>
      <p className={`${PANEL_LINE} lg:mt-4 lg:text-2xl lg:leading-8`}>{WHO_SEES_YOU.body}</p>
      <ul
        data-who-points=""
        className="mt-6 flex flex-col gap-5 rounded-card bg-card p-5 md:gap-6 md:p-8 lg:mt-8 lg:flex-1 lg:justify-evenly lg:gap-8 lg:px-8 lg:py-10"
      >
        {WHO_SEES_YOU.points.map((point) => (
          <li key={point.text} className="flex items-center gap-4 lg:gap-6">
            <Icon kind={point.icon} />
            <span className="body-l font-medium text-pretty md:text-xl md:leading-7 lg:text-2xl lg:leading-8">{point.text}</span>
          </li>
        ))}
      </ul>
      <Link
        href={WHO_SEES_YOU.link.href}
        className="mt-6 inline-flex min-h-12 items-center gap-2 self-start body-l font-semibold underline underline-offset-4 hover:decoration-2 lg:mt-8"
      >
        {WHO_SEES_YOU.link.label}
        <ArrowRightIcon className="size-5 shrink-0" />
      </Link>
    </section>
  );
}
