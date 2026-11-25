import type { Metadata } from "next";
import { MY_TICKETS_HEAD } from "@/components/account/account-heads";
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
      <AccountPageHead {...MY_TICKETS_HEAD} />
      <MyTicketsList />
    </>
  );
}
