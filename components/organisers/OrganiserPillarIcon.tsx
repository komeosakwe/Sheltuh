import type { OrganiserPillarIcon as IconName } from "./organisers-content";

/** 24px line icons for Create, Reach and Grow (decorative: each card's h3 names it). */
const PATHS: Record<IconName, readonly string[]> = {
  // A calendar with a plus.
  create: ["M4 6.5h16v13H4z", "M4 10.5h16", "M8.5 4v4", "M15.5 4v4", "M12 13v4.5", "M9.75 15.25h4.5"],
  // Two people.
  reach: [
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M3.5 19a5.5 5.5 0 0 1 11 0",
    "M16 11a2.5 2.5 0 1 0 0-5",
    "M17 14.2a4.5 4.5 0 0 1 3.5 4.8",
  ],
  // A bar chart.
  grow: ["M6 18v-4", "M10 18v-8", "M14 18v-5", "M18 18V6"],
};

export default function OrganiserPillarIcon({ name, className = "size-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
