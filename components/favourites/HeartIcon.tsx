/** The save heart (decorative: the control around it carries the name). Filled when saved. */
export default function HeartIcon({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      className={className}
      data-filled={filled ? "" : undefined}
    >
      <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z" />
    </svg>
  );
}
