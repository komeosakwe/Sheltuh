import type { ReactNode } from "react";

export default function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="eyebrow bg-highlight px-2 py-1 text-foreground">Demo — sample events</span>
      <span className="text-muted">{children}</span>
    </div>
  );
}
