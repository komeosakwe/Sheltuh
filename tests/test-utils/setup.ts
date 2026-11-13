import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no Tailwind, but it does hide a closed popover (`[popover]` is `display: none` until
 * it's open). The search bar's sheet (components/SearchBar.tsx) is a popover only below md; from
 * md it's `md:contents`, the inline bar. Component tests see the desktop layout, as a browser at
 * md and up does: this mirrors that one rule. (The location menu, a popover at every width, stays
 * hidden until opened, so tests query it with `hidden: true`.)
 */
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  // !important: jsdom ranks its own `[popover]:not(:popover-open)` rule by specificity, where a
  // browser lets any page style win over its defaults.
  style.textContent = "[data-search-sheet] { display: contents !important; }";
  document.head.append(style);
}
