"use client";

import { useId, useSyncExternalStore } from "react";
import { SelectedDots } from "@/components/ui/FilterChip";
import { getServerTheme, getTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";

const SEGMENT = "flex min-h-11 items-center gap-2 rounded-badge px-5 text-sm leading-5 font-semibold";

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
 * The Light / Dark switch (docs/design/theme-white-dark.md §5.6): a group of
 * two toggle buttons named "Theme", the map's Map / List segmented control
 * in look. 44px tall at every width. Choosing applies at once and is kept in
 * this browser; choosing the current one does nothing. In the footer (all
 * widths) and the phone menu. `data-theme-switch` lets the menu stay open
 * when it's used.
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
        className="mt-2 inline-flex gap-1 rounded-control border border-foreground bg-card p-1"
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
