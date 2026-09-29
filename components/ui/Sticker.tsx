/**
 * Occasional expressive graphic elements. Pure inline SVG/CSS, decorative
 * only (aria-hidden) — use sparingly, one or two per page.
 */

/** Rotating circular text badge, e.g. "Curated • Melbourne • ". */
export function RoundBadge({
  text = "Curated in Melbourne · Curated in Melbourne · ",
  className = "",
}: {
  text?: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className={`animate-[spin_24s_linear_infinite] motion-reduce:animate-none ${className}`}
    >
      <defs>
        <path id="badge-circle" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
      </defs>
      <text fontSize="9.5" fontWeight="700" letterSpacing="2.2" fill="currentColor">
        <textPath href="#badge-circle">{text.toUpperCase()}</textPath>
      </text>
      <circle cx="50" cy="50" r="5" fill="currentColor" />
    </svg>
  );
}

/** Hand-drawn-feeling asterisk burst — a nod to sticker/flyer culture. */
export function Burst({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <g stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        <line x1="50" y1="8" x2="50" y2="92" />
        <line x1="8" y1="50" x2="92" y2="50" />
        <line x1="20" y1="20" x2="80" y2="80" />
        <line x1="80" y1="20" x2="20" y2="80" />
      </g>
    </svg>
  );
}

/** Slow horizontal ticker used as a section divider. */
export function Marquee({ items }: { items: string[] }) {
  const row = (
    <span className="flex shrink-0 items-center gap-8 pr-8">
      {items.map((item) => (
        <span key={item} className="flex items-center gap-8">
          <span>{item}</span>
          <Burst className="h-4 w-4" />
        </span>
      ))}
    </span>
  );
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden whitespace-nowrap bg-foreground py-4 text-background"
    >
      <div className="display-md flex w-max animate-[marquee_40s_linear_infinite] motion-reduce:animate-none">
        {row}
        {row}
      </div>
    </div>
  );
}
