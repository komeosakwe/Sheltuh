/**
 * Site search: a plain GET form to /search?q=… so it works without JS and
 * needs no client state. `size="lg"` is the big version used on the search page.
 */
export default function SearchBar({
  defaultValue = "",
  size = "sm",
  autoFocus = false,
}: {
  defaultValue?: string;
  size?: "sm" | "lg";
  autoFocus?: boolean;
}) {
  const large = size === "lg";
  return (
    <form action="/search" method="get" role="search" className="w-full">
      <label htmlFor={`site-search-${size}`} className="sr-only">
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
            large ? "left-5 h-5 w-5" : "left-4 h-4 w-4"
          }`}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id={`site-search-${size}`}
          type="search"
          name="q"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          maxLength={100}
          placeholder="Search by event, venue or suburb"
          autoComplete="off"
          className={`w-full rounded-full! border-transparent! bg-surface! text-foreground placeholder:text-muted focus-visible:border-foreground! ${
            large ? "py-4 pl-13 pr-6 text-lg" : "py-2 pl-10 pr-4 text-sm"
          }`}
        />
      </div>
    </form>
  );
}
