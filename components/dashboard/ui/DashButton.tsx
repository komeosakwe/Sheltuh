import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, Ref } from "react";
import { Button, buttonClass, type ButtonVariant } from "@/components/ui/Button";

/** "Dash / Button" (Latte's dashboard Components 465:7337): Primary (orange), Dark (black), Outline. */
export type DashButtonVariant = "primary" | "dark" | "outline";

const VARIANTS: Record<DashButtonVariant, ButtonVariant> = {
  primary: "signal",
  dark: "solid",
  outline: "outline",
};

/**
 * The dashboard's button: px 20, radius 8, Label/Tag (12/16 Medium) and 40px tall, as the frames
 * draw Create event, Download statements and Edit event. Built on the site's `.btn`
 * (globals.css), so hover, keyboard focus, pressed, disabled and busy look as every other button
 * does (none of those are drawn): Primary turns black with an orange label, Outline fills black,
 * Dark goes a shade lighter. `block`: the dialogs' full-width 48px call to action (Label/Button).
 */
export function dashButtonClass(variant: DashButtonVariant = "primary", className = "", block = false) {
  return buttonClass(VARIANTS[variant], block ? "md" : "sm", sizeClass(block, className));
}

/** What the dashboard's sizes add to `.btn`'s S (40) and M (48). */
function sizeClass(block: boolean, className: string) {
  return `${block ? "w-full" : "min-h-10 px-5 py-2.5 label-tag"} ${className}`.trim();
}

type DashButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: DashButtonVariant;
  block?: boolean;
  className?: string;
  /** Its action is in progress: stays focusable, marked aria-disabled, ignores clicks (ui/Button `busy`). */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function DashButton({ variant = "primary", block = false, className = "", ...props }: DashButtonProps) {
  return <Button {...props} variant={VARIANTS[variant]} size={block ? "md" : "sm"} className={sizeClass(block, className)} />;
}

export function DashButtonLink({
  variant = "primary",
  block = false,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Link>, "className"> & { variant?: DashButtonVariant; block?: boolean; className?: string }) {
  return <Link {...props} className={dashButtonClass(variant, className, block)} />;
}
