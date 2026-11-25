import { MY_TICKETS_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";
import TicketsLoading from "@/components/tickets/TicketsLoading";

/** My tickets the moment it's opened, as the page first draws itself: the title, then the cards' shapes. */
export default function MyTicketsLoading() {
  return (
    <>
      <AccountPageHead {...MY_TICKETS_HEAD} />
      <p role="status" className="sr-only">
        Loading your tickets…
      </p>
      <TicketsLoading />
    </>
  );
}
