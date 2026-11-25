import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

/**
 * "Dash / Chip" (Latte's dashboard Components 465:7337): the Events filters (All · 6, Live · 3…),
 * the Orders filters and the Manage tabs (Edit, Insights, Orders · 52…). px 16, radius 8,
 * Label/Tag, 32px tall. Selected: filled in the text colour (black with a white label; inverted in
 * Dark). Otherwise the page colour with the 1.5px foreground stroke, surface/muted under the
 * pointer (as the sheet's third "Share event →" draws it). The state is never colour alone: a
 * filter says aria-pressed, a tab link aria-current.
 */
export function dashChipClass(selected: boolean, className = "") {
  return `label-tag inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-control border-control border-foreground px-4 py-1.5 whitespace-nowrap motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
    selected ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-surface"
  } ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

/** A filter chip: a button that says whether it's on (aria-pressed). */
export function DashChip({
  pressed,
  className = "",
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed" | "type"> & { pressed: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} className={dashChipClass(pressed, className)} {...props}>
      {children}
    </button>
  );
}

/**
 * A chip that goes somewhere (the Manage tabs: each is its own page): a link, aria-current="page"
 * on the one you're on.
 */
export function DashChipLink({
  current,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Link>, "aria-current"> & { current: boolean }) {
  return <Link aria-current={current ? "page" : undefined} className={dashChipClass(current, className)} {...props} />;
}
