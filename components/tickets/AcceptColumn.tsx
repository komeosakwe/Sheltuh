import type { ReactNode } from "react";

/** The Accept ticket page's column (AcceptTicketFlow), centred, 480px at most. */
export default function AcceptColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-120 flex-col gap-6">{children}</div>;
}
