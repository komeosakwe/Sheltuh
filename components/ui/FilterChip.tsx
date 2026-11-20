import type { ButtonHTMLAttributes, ReactNode } from "react";

/** A chip's height and width: one 48px line, or (`wrap`) at least 48px, as many lines as its label needs. */
export const CHIP_SIZING = {
  line: "h-12 shrink-0",
  wrap: "h-auto min-h-12 max-w-full py-2 text-left whitespace-normal",
} as const;

/**
 * A filter chip's classes (the rules' Tags & chips board, "Chips tap"): a
 * 48px rounded-square control (radius 8) with the 1.5px foreground stroke,
 * Label/Button. Unselected: the page colour, cream on hover. Selected:
 * foreground-filled with the page colour's label (black with white in Light,
 * white with black in Dark), plus the two orange dots where the chip shows
 * them. Also used for a native control that sits in a row of chips (the
 * map's date field). `wrap`: at least 48px rather than exactly, its label
 * free to wrap onto more lines when the text is large (a long list of
 * chips in a form), never wider than its row.
 */
export function filterChipClass(selected: boolean, className = "", wrap = false) {
  return `label-button inline-flex ${CHIP_SIZING[wrap ? "wrap" : "line"]} items-center gap-2 rounded-control border-control border-foreground px-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
    selected ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-hover"
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
  wrap = false,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  pressed: boolean;
  children: ReactNode;
  /** The label may wrap at large text (filterChipClass). */
  wrap?: boolean;
}) {
  return (
    <button type="button" aria-pressed={pressed} className={filterChipClass(pressed, className, wrap)} {...props}>
      {pressed && <SelectedDots />}
      {children}
    </button>
  );
}
