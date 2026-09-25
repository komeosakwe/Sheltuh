import type { ReactNode } from "react";

export default function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-md border px-4 py-3 text-sm text-foreground"
      style={{ borderColor: "rgba(225,91,39,0.4)", background: "rgba(225,91,39,0.1)" }}
    >
      <span className="font-heading mr-2 align-middle" style={{ color: "#e15b27" }}>
        Demo — sample events
      </span>
      <span className="align-middle text-muted">{children}</span>
    </div>
  );
}
