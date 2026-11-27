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
 * A secondary action with an icon (the organiser profile's Share), as
 * the rules' Secondary button: the 1.5px foreground stroke on the page
 * colour, black with a white label on hover (white with black in Dark), 48px
 * tall, Label/Button. Never a purchase.
 */
export const secondaryActionClass =
  "label-button inline-flex min-h-12 items-center gap-2 rounded-control border-control border-foreground px-4 text-foreground motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out hover:bg-foreground hover:text-background";

/**
 * The event page's photo marks (SaveButton's `variant="photo"` and ShareButton's `look="photo"`; owner, 27 Nov
 * 2026: Option A): a 40px white rounded square with a black 20px icon in a 48px target below 640px; from 640px a
 * 44px chip, as tall as its target, with a 16px icon and its word. Paper and
 * ink in both themes, as the card overlay is (they sit on a photo): `data-surface="paper"` on
 * the mark pins its tokens to Light, so its cream hover (`--hover`) is cream in Dark too. That rule is unlayered
 * (globals.css) and paints the mark white, so the hover fill needs `!` to win over it. Keyboard focus: the target's
 * own outline gives way to a two-tone ring on the mark, black against the white mark and white outside that, so it
 * shows on any photo, dark or light (never orange). Pressed, the mark shrinks a little (motion-safe only).
 */
export const photoMarkTargetClass =
  "flex size-12 items-center justify-center rounded-control focus-visible:outline-none! sm:size-auto sm:min-h-11";

/** The photo mark itself, inside its target (see photoMarkTargetClass). `group` is the target's group name. */
export function photoMarkClass(group: "save" | "share") {
  const hover = group === "save" ? "group-hover/save:bg-hover!" : "group-hover/share:bg-hover!";
  const focus =
    group === "save"
      ? "group-focus-visible/save:ring-2 group-focus-visible/save:ring-paper group-focus-visible/save:ring-offset-2 group-focus-visible/save:ring-offset-ink"
      : "group-focus-visible/share:ring-2 group-focus-visible/share:ring-paper group-focus-visible/share:ring-offset-2 group-focus-visible/share:ring-offset-ink";
  const press = group === "save" ? "motion-safe:group-active/save:scale-90" : "motion-safe:group-active/share:scale-90";
  return `flex size-10 items-center justify-center rounded-control bg-paper text-ink motion-safe:transition motion-safe:duration-150 motion-safe:ease-out ${press} ${hover} ${focus} sm:h-11 sm:w-auto sm:gap-1.5 sm:px-3`;
}

/** The photo mark's word, from 640px ("Save", "Share"): 14/20, 600. */
export const photoMarkLabelClass = "hidden text-sm leading-5 font-semibold sm:inline";

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
