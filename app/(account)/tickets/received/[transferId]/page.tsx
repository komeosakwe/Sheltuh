import type { Metadata } from "next";
import ReceivedTicket from "@/components/tickets/ReceivedTicket";

// Only for the account that accepted it (the API checks); kept out of search and Referers all the same.
export const metadata: Metadata = {
  title: "Your ticket — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A ticket someone sent the signed-in member, once accepted: their own QR code. */
export default async function ReceivedTicketPage({ params }: PageProps<"/tickets/received/[transferId]">) {
  const { transferId } = await params;
  return <ReceivedTicket transferId={transferId} />;
}
