import { useId } from "react";

/**
 * Site search: a plain GET form to /search?q=… so it works without JS and
 * needs no client state. `size="lg"` is the big version used on the search page.
 * `submit` adds a round yellow search button inside the field (phone home).
 */
export default function SearchBar({
  defaultValue = "",
  size = "sm",
  autoFocus = false,
  label = "Search",
  submit = false,
  placeholder = "Search by event, venue or suburb",
}: {
  defaultValue?: string;
  size?: "sm" | "lg";
  autoFocus?: boolean;
  /** Names the search landmark — the nav and the search page each have one. */
  label?: string;
  /** Show a visible submit button (the form still submits on Enter either way). */
  submit?: boolean;
  placeholder?: string;
}) {
  const large = size === "lg";
  // Unique per instance: the page can hold more than one bar of the same size.
  const inputId = useId();
  const inputSize = submit
    ? "h-13 py-0 pl-12 pr-14 text-base"
    : large
      ? "py-4 pl-13 pr-6 text-lg"
      : "py-2 pl-10 pr-4 text-sm";
  return (
    <form action="/search" method="get" role="search" aria-label={label} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Search by event, venue or suburb
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${
            submit ? "left-4 h-5 w-5" : large ? "left-5 h-5 w-5" : "left-4 h-4 w-4"
          }`}
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
          className={`w-full rounded-full! border-foreground! bg-surface! text-foreground placeholder:text-muted ${inputSize}`}
        />
        {submit && (
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-highlight text-foreground hover:bg-foreground hover:text-highlight"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-5 w-5"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
