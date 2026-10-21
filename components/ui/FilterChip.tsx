import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A filter chip's classes (docs/design/brand-direction-one.md §6.3): a white
 * rounded-square control with a black boundary; selected, it turns black.
 * 44px tall on phones, 40px from 640px. Also used for a native control
 * that sits in a row of chips (the map's date field).
 */
export function filterChipClass(selected: boolean, className = "") {
  return `inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-foreground px-3.5 text-sm leading-5 font-medium sm:h-10 ${
    selected ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-surface"
  } ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

/** The selected marker (§5 #3): two 4px orange squares, 2px apart, on the black chip (6.18:1). */
export function SelectedDots() {
  return (
    <span aria-hidden="true" data-selected-dots="" className="flex shrink-0 gap-0.5">
      <span className="size-1 rounded-[1px] bg-signal" />
      <span className="size-1 rounded-[1px] bg-signal" />
    </span>
  );
}

/**
 * A toggle chip: a button with `aria-pressed`, so the selected state is
 * announced, not shown by colour alone (it also gains the two dots and
 * inverts).
 */
export default function FilterChip({
  pressed,
  children,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & { pressed: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} className={filterChipClass(pressed, className)} {...props}>
      {pressed && <SelectedDots />}
      {children}
    </button>
  );
}
