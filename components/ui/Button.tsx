import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, Ref } from "react";

/**
 * `signal` (Signal Orange) is the one primary conversion action per viewport:
 * the home hero, the event page's Get tickets, Join waitlist. Never in
 * checkout, forms, dashboards or admin, and never inside an orange section.
 * `solid` (black) is every other primary action. On black, put the button
 * inside `data-surface="ink"` and use `outline`, which the scope inverts
 * (the old `light` variant is retired).
 */
export type ButtonVariant = "solid" | "signal" | "outline" | "danger";
/** sm 32px, md 40px, and `lg`, the 48px thumb action on phones. */
export type ButtonSize = "sm" | "md" | "lg";

/** Rounded-square buttons (docs/design/brand-direction-one.md §6.1). Styles live in globals.css (.btn). */
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
