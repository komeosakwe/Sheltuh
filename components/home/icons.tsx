/** Small inline icons for the home page. All decorative (`aria-hidden`); the text beside them carries the meaning. */

const common = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ArrowRightIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function CalendarIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function PinIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2} className={className}>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

/** "Opens elsewhere" (an arrow out of a box): outbound ticket links, Get directions. */
export function ExternalIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={1.75} className={className}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/** A person (head and shoulders): the event page's organiser line. */
export function PersonIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </svg>
  );
}
