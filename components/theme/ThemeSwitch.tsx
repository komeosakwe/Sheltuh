"use client";

import { useId, useSyncExternalStore } from "react";
import { FOOTER_LABEL_CLASS } from "@/components/footer/footer-styles";
import { getServerTheme, getTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";

/** Label/Button (SemiBold 16/24) with 16 × 8 padding: 40px tall, as Latte's 1120 footer draws the options. */
const SEGMENT = "label-button rounded-badge px-4 py-2";

/**
 * Each segment's look comes from CSS (the `dark:` variant reads <html>'s data-theme), so it's right
 * on the first paint, before hydration knows the theme; aria-pressed follows once it does. The chosen
 * option is a white pill with black words, the other #bfbfbf words on the black switch.
 */
const OPTIONS: { theme: Theme; label: string; className: string }[] = [
  {
    theme: "light",
    label: "Light",
    className: "bg-foreground text-background dark:bg-transparent dark:text-footer-quiet dark:hover:bg-surface",
  },
  {
    theme: "dark",
    label: "Dark",
    className: "text-footer-quiet hover:bg-surface dark:bg-foreground dark:text-background dark:hover:bg-foreground",
  },
];

/**
 * The Light / Dark switch, as Latte's 1120 footer draws it ("Theme toggle"): a "Theme" label in
 * Mono/S #999 over a group of two toggle buttons named "Theme", 56 tall with 8 inside, radius 8, a
 * 1px #595959 border on black. Choosing applies at once and is kept in this browser; choosing the
 * current one does nothing. In the footer only (the rules' Navigation board: "Theme toggle: Footer
 * only"), which is an ink section in both themes, so its colours are the footer's.
 */
export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const labelId = useId();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <div data-theme-switch="" className={`flex flex-col items-start gap-2 ${className}`.trim()}>
      <p id={labelId} className={FOOTER_LABEL_CLASS}>
        Theme
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex h-14 items-center gap-2 rounded-control border border-footer-line bg-background px-2"
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
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
