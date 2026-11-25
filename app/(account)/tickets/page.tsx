import type { Metadata } from "next";
import AccountPageHead from "@/components/account/AccountPageHead";
import MyTicketsList from "@/components/tickets/MyTicketsList";

// A signed-in member's own list: nothing here for search engines.
export const metadata: Metadata = {
  title: "My tickets — Sheltüh",
  robots: { index: false, follow: false },
};

/** My tickets: the orders the member bought (by their verified email) and the tickets sent to them. */
export default function MyTicketsPage() {
  return (
    <>
      <AccountPageHead title="My tickets" intro="Tickets you’ve bought or been sent." />
      <MyTicketsList />
    </>
  );
}
