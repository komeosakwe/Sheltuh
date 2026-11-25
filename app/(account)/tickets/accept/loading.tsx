import AcceptColumn from "@/components/tickets/AcceptColumn";
import { LoadingState } from "@/components/ui/ProgressLoader";

/** Accept ticket the moment it's opened, as the page first draws itself (AcceptTicketFlow), not My tickets' list. */
export default function AcceptTicketLoading() {
  return (
    <AcceptColumn>
      <LoadingState text="Opening your ticket…" />
    </AcceptColumn>
  );
}
