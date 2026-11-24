import type { Metadata } from "next";
import AcceptTicketFlow from "@/components/tickets/AcceptTicketFlow";

// An accept link carries its token in the fragment (#token=…). next.config.ts also sends noindex and
// no-referrer for this path, as for the other emailed-link pages.
export const metadata: Metadata = {
  title: "Accept your ticket — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A ticket someone sent: accept or decline it (Latte's 1120 Accept ticket frames, in the account frame). */
export default function AcceptTicketPage() {
  return <AcceptTicketFlow />;
}
