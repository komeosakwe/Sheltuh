import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

export type ButtonVariant = "solid" | "outline" | "light" | "danger";
export type ButtonSize = "sm" | "md";

/** Small pill CTA — the only place fully rounded shapes appear in the UI. Styles live in globals.css (.btn). */
export function buttonClass(
  variant: ButtonVariant = "solid",
  size: ButtonSize = "md",
  className = "",
) {
  const variants: Record<ButtonVariant, string> = {
    solid: "btn-solid",
    outline: "btn-outline",
    light: "btn-outline border-background text-background hover:!bg-background hover:!text-foreground",
    danger: "btn-danger",
  };
  return `btn ${variants[variant]} ${size === "sm" ? "btn-sm" : ""} ${className}`.replace(/\s+/g, " ").trim();
}

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & StyleProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & StyleProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
