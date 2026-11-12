"use client";

import { useId, useSyncExternalStore } from "react";
import { SelectedDots } from "@/components/ui/FilterChip";
import { getServerTheme, getTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";

/** 48px on phones and tablets, 40px from `lg` (the rules: icon-sized controls are 40 on desktop). */
const SEGMENT = "flex min-h-12 items-center gap-2 rounded-badge px-4 text-sm leading-5 font-semibold lg:min-h-10";

/**
 * Each segment's look comes from CSS (the `dark:` variant reads <html>'s
 * data-theme), so it's right on the first paint, before hydration knows the
 * theme; aria-pressed follows once it does.
 */
const OPTIONS: { theme: Theme; label: string; className: string; dots: string }[] = [
  {
    theme: "light",
    label: "Light",
    className: "bg-foreground text-background dark:bg-transparent dark:text-foreground dark:hover:bg-surface",
    dots: "flex dark:hidden",
  },
  {
    theme: "dark",
    label: "Dark",
    className: "text-foreground hover:bg-surface dark:bg-foreground dark:text-background dark:hover:bg-foreground",
    dots: "hidden dark:flex",
  },
];

/**
 * The Light / Dark switch (docs/design/theme-white-dark.md §5.6; the redesign proposal's
 * footer): a "Theme" eyebrow over a group of two toggle buttons named "Theme", radius 8 with the
 * 1.5px stroke. Choosing applies at once and is kept in this browser; choosing the current one
 * does nothing. In the footer only (the rules' Navigation board: "Theme toggle: Footer only").
 */
export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const labelId = useId();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <div data-theme-switch="" className={className || undefined}>
      <p id={labelId} className="eyebrow text-muted">
        Theme
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        className="mt-2 inline-flex gap-1 rounded-control border-control border-foreground bg-card p-1"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.theme}
            type="button"
            aria-pressed={theme === option.theme}
            onClick={() => {
              if (getTheme() !== option.theme) setTheme(option.theme);
            }}
            className={`${SEGMENT} ${option.className}`}
          >
            <span className={option.dots}>
              <SelectedDots />
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
