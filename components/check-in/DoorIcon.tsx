/** The door scanner's icon set (docs/design/check-in.md §2.4). Always decorative: words carry the meaning. */
export type DoorIconName = "check" | "cross" | "alert" | "undo";

export default function DoorIcon({ name, className = "" }: { name: DoorIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={`shrink-0 ${className}`.trim()}
      data-icon={name}
    >
      {name === "check" && <path d="M4 12.5 9.5 18 20 6.5" />}
      {name === "cross" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "alert" && (
        <>
          <path d="M12 3 22.5 21h-21z" strokeWidth="2.5" />
          <path d="M12 9.5v5" />
          <circle cx="12" cy="17.75" r="1.25" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "undo" && (
        <>
          <path d="M9 15 4 10l5-5" />
          <path d="M4 10h10.5a5.5 5.5 0 0 1 0 11H11" />
        </>
      )}
    </svg>
  );
}
