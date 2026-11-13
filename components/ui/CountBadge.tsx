/**
 * A small black count beside a link's label ("Messages 3", "Admin 5"). The
 * number is decorative (aria-hidden, capped at 99+); `srText` puts the full
 * count into the link's name instead (", 3 unread"), read when the link is.
 * Never a live region: counts change in the background, and announcing that
 * would be noise. Black on white and white on black (dark theme) are both
 * well above 4.5:1. `tone="signal"` (the header's Messages button, the rules'
 * Navigation board) is orange with a black number, 6.18:1. Nothing for 0.
 */
export default function CountBadge({
  count,
  srText,
  dataAttribute,
  tone = "plain",
}: {
  count: number | null | undefined;
  /** Screen-reader text after the label, starting with its separator: ", 3 unread". */
  srText: string;
  /** A data attribute for the visible number (tests and styling hooks), e.g. "data-unread-badge". */
  dataAttribute?: `data-${string}`;
  tone?: "plain" | "signal";
}) {
  if (!count) return null;
  const shown = count > 99 ? "99+" : String(count);
  const data = dataAttribute ? { [dataAttribute]: "" } : {};
  return (
    <>
      <span
        aria-hidden="true"
        {...data}
        className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-badge px-1 align-middle text-xs leading-5 font-semibold tracking-normal tabular-nums normal-case ${
          tone === "signal" ? "bg-signal text-signal-foreground" : "bg-foreground text-background"
        }`}
      >
        {shown}
      </span>
      <span className="sr-only">{srText}</span>
    </>
  );
}
