import type { ReactNode } from "react";
import DotsMark from "@/components/brand/DotsMark";

/**
 * The running strap (docs/design/brand-direction-one.md §6.4): a 1px black
 * rule, then the two dots and a short mono label, with an optional muted
 * note on the right. `rule={false}` for a page header, where the header's
 * own rule is just above. Never on `bg-surface` (the orange dots would
 * fall under 3:1 there).
 */
export default function Strap({
  label,
  note,
  rule = true,
  className = "",
}: {
  label: ReactNode;
  note?: ReactNode;
  rule?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`eyebrow flex items-center justify-between gap-4 ${rule ? "border-t border-foreground pt-2" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      <p className="flex min-w-0 items-center gap-2">
        <DotsMark size="xs" className="text-signal" />
        <span className="min-w-0 truncate">{label}</span>
      </p>
      {note && <p className="shrink-0 text-muted">{note}</p>}
    </div>
  );
}
