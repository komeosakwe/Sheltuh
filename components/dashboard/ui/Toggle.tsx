"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * "Dash / Toggle" (Latte's dashboard Components 465:7337): a 44 × 24 switch. On: an orange
 * track with the white knob at the right. Off: the surface/muted track, knob at the left, plus a
 * 1px text/secondary edge the frame doesn't draw (the off track is 1.1:1 on white; WCAG 1.4.11
 * wants 3:1 for a control's boundary). A button with role="switch" and aria-checked, so it's read
 * "on" / "off" and toggled with Space or Enter. Name it with `aria-label` or `aria-labelledby`
 * (SettingRow does). Disabled: a flat grey track (not see-through, which would turn the orange
 * pink). The knob slides only for people who don't prefer reduced motion.
 */
export default function Toggle({
  checked,
  onCheckedChange,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked" | "onClick" | "type"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      data-toggle={checked ? "on" : "off"}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 disabled:cursor-not-allowed motion-safe:transition-colors motion-safe:duration-200 ${
        props.disabled ? "bg-surface-border" : checked ? "bg-signal" : "bg-surface ring-1 ring-muted ring-inset"
      } ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`size-5 rounded-full bg-paper motion-safe:transition-transform motion-safe:duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}
