import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A filter chip's classes (docs/design/brand-direction-one.md §6.3, owner
 * round of 23 Oct 2026): unselected, a card-coloured rounded-square control
 * with a subtle grey boundary (`foreground` at 50%: #808080 on white,
 * 3.95:1; about #8a8a8a on Dark's #141414 card, 5.3:1 against it and 6.1:1
 * against the black page, so it's still a visible control, WCAG 1.4.11);
 * selected, solid `foreground` (fill and boundary) with `background`-coloured
 * text, i.e. black with white text in Light and white with black text in Dark,
 * plus the two orange dots where the chip shows them. 44px tall on phones,
 * 40px from 640px. Also used for a native control that sits in a row of
 * chips (the map's date field).
 */
export function filterChipClass(selected: boolean, className = "") {
  return `inline-flex h-11 shrink-0 items-center gap-2 rounded-control border px-3.5 text-sm leading-5 font-medium sm:h-10 ${
    selected
      ? "border-foreground bg-foreground text-background"
      : "border-foreground/50 bg-card text-foreground hover:border-foreground hover:bg-surface"
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
