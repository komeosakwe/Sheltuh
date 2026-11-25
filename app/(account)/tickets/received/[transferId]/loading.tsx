import { LoadingState } from "@/components/ui/ProgressLoader";

/** A received ticket the moment it's opened, as the page first draws itself (ReceivedTicket), not My tickets' list. */
export default function ReceivedTicketLoading() {
  return <LoadingState text="Loading your ticket…" />;
}
