import { useId } from "react";
import LocationPicker from "@/components/search/LocationPicker";

/**
 * Site search, one bar (the rules' Search board: "Search once … One bar, one location menu"):
 * the words ("Search events") | a divider | Where | an orange Search button, as a plain GET form
 * to /search?q=…&near=… that works without JS. In the home's hero and on /search; the header has
 * none (owner decision). When is deferred: /search reads only `q` and `near`.
 *
 * Radius 8 with the 1.5px black stroke on white (--card), no pill. Every target inside is 48px.
 * The words field is named by its placeholder, the only words it shows (WCAG 2.5.3), in 16px
 * text so iOS doesn't zoom. Below 640px the submit is just its icon (still named "Search") and
 * the field drops its magnifier, so the words keep their room in a 288px bar. Focus rings inside
 * the bar are drawn inset, so they don't cross its stroke. The Where segment and its location
 * menu are components/search/LocationPicker.tsx (the only client part, so this stays usable from
 * server components); the location it sets is the one remembered suburb every page uses.
 */
export default function SearchBar({
  defaultValue = "",
  near,
  appliedNear,
  autoFocus = false,
  label = "Search events",
  placeholder = "Search events",
}: {
  defaultValue?: string;
  /** /search passes its `near` when the address has one, so the bar mirrors it; otherwise the remembered suburb is used. */
  near?: string;
  /**
   * /search only: the suburb its results are ordered by ("" for none). The bar then says
   * "Press Search to update results" while its location differs from it.
   */
  appliedNear?: string;
  autoFocus?: boolean;
  /** Names the search landmark. */
  label?: string;
  placeholder?: string;
}) {
  // Unique per instance: the page can hold more than one bar.
  const inputId = useId();
  return (
    <form action="/search" method="get" role="search" aria-label={label} className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <div
        data-search-bar=""
        className="flex w-full items-center gap-1 rounded-control border-control border-foreground bg-card p-1 text-foreground"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="ml-3 hidden size-5 shrink-0 sm:block"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
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
          className="h-12 min-w-0 flex-1 border-0 bg-transparent px-3 py-0 text-base text-ellipsis text-foreground placeholder:text-muted focus-visible:-outline-offset-2! sm:pl-2"
        />
        <span aria-hidden="true" className="h-8 w-px shrink-0 bg-surface-border" />
        <LocationPicker near={near} appliedNear={appliedNear} />
        <button
          type="submit"
          data-search-submit=""
          className="btn btn-signal min-h-12 min-w-12 shrink-0 gap-2 px-3 focus-visible:-outline-offset-2! sm:px-4"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="size-5"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only sm:not-sr-only">Search</span>
        </button>
      </div>
    </form>
  );
}
