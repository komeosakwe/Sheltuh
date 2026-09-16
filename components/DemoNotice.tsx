import type { ReactNode } from "react";

export default function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground"
    >
      <span className="font-heading mr-2 align-middle text-accent">Demo — sample events</span>
      <span className="align-middle text-muted">{children}</span>
    </div>
  );
}
