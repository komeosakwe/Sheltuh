import { useId } from "react";
import LocationPicker from "@/components/search/LocationPicker";

/**
 * Site search, one bar in three places (the home hero, the desktop header,
 * /search): the words | a divider | the location segment | Search, as a
 * plain GET form to /search?q=…&near=… that works without JS.
 *
 * Owner round of 24 Oct 2026 ("our search bar similar [to Eventbrite] and a
 * close location"): a pill with a round submit, an owner-approved exception
 * to "no pills, no circles" (docs/design-system.md). `tone="signal"` is the
 * orange submit with a black icon (hero and /search, where search is the
 * page's main action); `tone="plain"` is black, orange on hover (the header,
 * beside pages' own orange actions).
 *
 * `size="lg"` is 52px tall with 16px text (no iOS zoom), `size="sm"` 44px
 * with 14px text (the desktop header only). The words field is named by its
 * placeholder, the only words it shows (WCAG 2.5.3); the location segment
 * and its popover are components/search/LocationPicker.tsx (the only client
 * part, so this stays usable from server components).
 */
export default function SearchBar({
  defaultValue = "",
  near,
  appliedNear,
  size = "sm",
  tone = "plain",
  autoFocus = false,
  label = "Search",
  placeholder = "Search by event or venue",
}: {
  defaultValue?: string;
  /** /search passes its `near` when the address has one, so the bar mirrors it; otherwise the remembered suburb is used. */
  near?: string;
  /**
   * /search only: the suburb its results are ordered by ("" for none). The bar then says
   * "Press Search to update results" while its location differs from it.
   */
  appliedNear?: string;
  size?: "sm" | "lg";
  tone?: "signal" | "plain";
  autoFocus?: boolean;
  /** Names the search landmark — the nav and the search page each have one. */
  label?: string;
  placeholder?: string;
}) {
  const large = size === "lg";
  // Unique per instance: the page can hold more than one bar.
  const inputId = useId();
  const submitTone =
    tone === "signal"
      ? "btn btn-signal"
      : "border border-foreground bg-foreground text-background hover:border-signal hover:bg-signal hover:text-signal-foreground";
  return (
    <form action="/search" method="get" role="search" aria-label={label} className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <div
        data-search-bar=""
        className={`flex w-full items-center rounded-full border border-foreground bg-card p-1 ${large ? "h-13" : "h-11"}`}
      >
        <input
          id={inputId}
          type="search"
          name="q"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          maxLength={100}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className={`h-full min-w-0 flex-1 rounded-full border-0 bg-transparent py-0 text-ellipsis text-foreground placeholder:text-muted focus-visible:-outline-offset-2! ${
            large ? "pr-2 pl-3 text-base sm:pl-4" : "pr-2 pl-3 text-sm"
          }`}
        />
        <span aria-hidden="true" className="h-7 w-px shrink-0 bg-foreground/50" />
        <LocationPicker near={near} appliedNear={appliedNear} size={size} />
        <button
          type="submit"
          aria-label="Search"
          data-search-submit=""
          className={`${submitTone} flex shrink-0 items-center justify-center rounded-full p-0 focus-visible:-outline-offset-2! ${
            large ? "size-11 min-h-11" : "size-9 min-h-9"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className={large ? "h-5 w-5" : "h-4 w-4"}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>
      </div>
    </form>
  );
}
