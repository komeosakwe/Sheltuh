/** The checkout pages' small icons. Decorative (`aria-hidden`): the text beside them carries the meaning. */

const common = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ArrowLeftIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function CheckIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={2.5} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A ticket stub with a notch each side (the ticket panel's heading mark). */
export function TicketIcon({ className = "size-8 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} strokeWidth={1.75} className={className}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5Z" />
      <path d="M14 6v2.5M14 11v2M14 15.5V18" />
    </svg>
  );
}

export function LockIcon({ className = "size-5 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** A circled "i". */
export function InfoIcon({ className = "size-5 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function UsersIcon({ className = "size-5 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </svg>
  );
}
