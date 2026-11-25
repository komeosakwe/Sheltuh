"use client";

import Link from "next/link";
import MyTicketView from "@/components/tickets/MyTicketView";
import MyTicketsBackLink from "@/components/tickets/MyTicketsBackLink";
import { sampleTicketOrder } from "@/lib/sample-order";

/**
 * The ticket page in the demo (no API): a sample ticket to a sample event, so
 * the page can be seen end to end. Nothing here is a real order; the demo's
 * banner says the site is running on sample data. "← My tickets" goes back to
 * the demo's sample list (/tickets), whose order cards open this page.
 */
export default function DemoTicket() {
  const sample = sampleTicketOrder();
  if (!sample) {
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <h1 className="display-md text-balance">No sample ticket</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
          Back to Sheltüh
        </Link>
      </div>
    );
  }
  return (
    <>
      <MyTicketsBackLink className="mb-6 lg:mb-8" />
      <MyTicketView order={sample.order} sessionId={null} event={sample.event} />
    </>
  );
}
