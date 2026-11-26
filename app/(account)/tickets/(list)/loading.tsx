import { MY_TICKETS_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";
import TicketsLoading from "@/components/tickets/TicketsLoading";

/**
 * My tickets the moment it's opened, as the page first draws itself: the title, then the cards' shapes. In its own
 * route group, so it wraps the list only: a loading screen here wraps every route below it, and Next prefetches a
 * dynamic route only as far as its first one, so /tickets/received/{id} and /tickets/accept would otherwise open on
 * this skeleton first. They have their own.
 */
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
