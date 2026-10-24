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

export function ChevronDownIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
