/**
 * A small black count beside a link's label ("Messages 3", "Admin 5"). The
 * number is decorative (aria-hidden, capped at 99+); `srText` puts the full
 * count into the link's name instead (", 3 unread"), read when the link is.
 * Never a live region: counts change in the background, and announcing that
 * would be noise. Black on white and white on black (dark theme) are both
 * well above 4.5:1. `tone="signal"` (the header's Messages button, the rules'
 * Navigation board) is orange with a black number, 6.18:1. Nothing for 0.
 *
 * `shape="pill"`: the 24 × 16 pill the "Navigation" board draws for the header's Messages chip and
 * the avatar menu's counts (navigation-search.md §5.16), with no margin of its own (those rows
 * space it). The default is the 20px square-cornered badge everywhere else.
 */
export default function CountBadge({
  count,
  srText,
  dataAttribute,
  tone = "plain",
  shape = "badge",
}: {
  count: number | null | undefined;
  /** Screen-reader text after the label, starting with its separator: ", 3 unread". */
  srText: string;
  /** A data attribute for the visible number (tests and styling hooks), e.g. "data-unread-badge". */
  dataAttribute?: `data-${string}`;
  tone?: "plain" | "signal";
  shape?: "badge" | "pill";
}) {
  if (!count) return null;
  const shown = count > 99 ? "99+" : String(count);
  const data = dataAttribute ? { [dataAttribute]: "" } : {};
  return (
    <>
      <span
        aria-hidden="true"
        {...data}
        className={`inline-flex items-center justify-center align-middle text-xs font-semibold tracking-normal tabular-nums normal-case ${
          shape === "pill" ? "h-4 min-w-6 rounded-full px-2 leading-4" : "ml-1.5 h-5 min-w-5 rounded-badge px-1 leading-5"
        } ${tone === "signal" ? "bg-signal text-signal-foreground" : "bg-foreground text-background"}`}
      >
        {shown}
      </span>
      <span className="sr-only">{srText}</span>
    </>
  );
}
