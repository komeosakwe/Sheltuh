import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, Ref } from "react";

/**
 * The rules' button hierarchy. `signal` (Signal Orange, the Primary) is the
 * one primary action per view: Buy tickets, Join free, the home hero. Never
 * in checkout, forms, dashboards or admin, and never inside an orange
 * section. `outline` is the Secondary: the 1.5px stroke, filled black on
 * hover ("I'm going", Share). `solid` (black) is any other strong action.
 * On black, put the button inside `data-surface="ink"`, which inverts
 * `outline` and `solid`.
 */
export type ButtonVariant = "solid" | "signal" | "outline" | "danger";
/** S 40px (inline and the header), M 48px (forms and panels, the default), L 56px (the hero and the sticky bar). */
export type ButtonSize = "sm" | "md" | "lg";

/** Radius-8 buttons in Label/Button, sentence case (the rules' Buttons board). Styles live in globals.css (.btn). */
export function buttonClass(
  variant: ButtonVariant = "solid",
  size: ButtonSize = "md",
  className = "",
) {
  const variants: Record<ButtonVariant, string> = {
    solid: "btn-solid",
    signal: "btn-signal",
    outline: "btn-outline",
    danger: "btn-danger",
  };
  const sizes: Record<ButtonSize, string> = { sm: "btn-sm", md: "", lg: "btn-lg" };
  return `btn ${variants[variant]} ${sizes[size]} ${className}`.replace(/\s+/g, " ").trim();
}

/**
 * A secondary action with an icon (the event page's Save and Share row), as
 * the rules' Secondary button: the 1.5px foreground stroke on the page
 * colour, black with a white label on hover (white with black in Dark), 48px
 * tall, Label/Button. Never a purchase.
 */
export const secondaryActionClass =
  "label-button inline-flex min-h-12 items-center gap-2 rounded-control border-control border-foreground px-4 text-foreground motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out hover:bg-foreground hover:text-background";

/**
 * Save, Share and Calendar in the event page's action row (the owner's event reference, 13 Nov 2026): the Secondary
 * button filling a third of the row, 48px tall at every width, icon and label on one line in Instrument Sans 500
 * (14px; 16px on tablets, where a third of the row is wide). Each label is one short word, so it fits a third of a
 * 320px screen beside its icon. (`!` where it overrides secondaryActionClass's own gap, padding, size and weight.)
 */
export const actionRowClass = `${secondaryActionClass} w-full justify-center gap-1.5! px-1! text-center whitespace-nowrap font-medium! text-sm! sm:text-base! lg:text-sm!`;

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function ignoreWhileBusy(event: MouseEvent<HTMLButtonElement>) {
  // Also stops a submit button from submitting its form again.
  event.preventDefault();
}

/**
 * `busy`: its action is in progress. Unlike `disabled`, the button keeps
 * keyboard focus (a focused button that becomes disabled drops focus to the
 * page); it's marked `aria-disabled`, styled as disabled, and ignores clicks.
 * Client components only (it swaps in a click handler).
 */
export function Button({
  variant,
  size,
  className,
  type = "button",
  busy = false,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & StyleProps & { busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
      aria-disabled={busy ? true : props["aria-disabled"]}
      onClick={busy ? ignoreWhileBusy : onClick}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & StyleProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
