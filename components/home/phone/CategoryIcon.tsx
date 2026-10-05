import type { ReactNode } from "react";

/** Hand-made 24×24 stroke icons for the phone home's category row. Decorative: the label beside each carries the meaning. */

export type CategoryIconName = "music" | "art" | "workshop" | "pop-up" | "theatre" | "free";

const paths: Record<CategoryIconName, ReactNode> = {
  // A pair of quavers.
  music: (
    <>
      <path d="M9 18V5.5l11-2.5v12.5" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="15.5" r="2.5" />
    </>
  ),
  // A framed picture: a sun over hills.
  art: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="m3.5 17.5 5-5 4 4 2.5-2.5 5.5 5.5" />
    </>
  ),
  // A hand holding a paintbrush.
  workshop: (
    <>
      <path d="M13.5 3.5 20.5 10.5" />
      <path d="M12 5l7 7-3 3-7-7z" />
      <path d="M9 8c-1.5 1.5-3.5 2-5 1.5" />
      <path d="M4 20.5c1-3 2.5-5 5-6.5l2 2c-1.5 2.5-3.5 4-6.5 5" />
    </>
  ),
  // A storefront under a scalloped awning.
  "pop-up": (
    <>
      <path d="M3 9 4.5 4h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  // A stage with its curtains drawn back.
  theatre: (
    <>
      <path d="M3 3.5h18M3 20.5h18M4 3.5v17M20 3.5v17" />
      <path d="M4 3.5c0 5.5 2.5 8.5 6.5 9.5M20 3.5c0 5.5-2.5 8.5-6.5 9.5" />
    </>
  ),
  // A price tag.
  free: (
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
};

export default function CategoryIcon({ name, className = "h-6 w-6" }: { name: CategoryIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
