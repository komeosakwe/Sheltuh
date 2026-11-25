import Link from "next/link";
import { MY_TICKETS_HREF } from "@/lib/my-tickets-href";

/**
 * "← My tickets" above a ticket page (docs/design/my-ticket.md §4: the back link, Sans 600 16/24, then the
 * page), for a member who's signed in: the order page and a received ticket. 44px to touch.
 */
export default function MyTicketsBackLink({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <Link
        href={MY_TICKETS_HREF}
        data-my-tickets-back=""
        className="body-m -my-2.5 inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline-offset-4 hover:underline print:hidden"
      >
        <span aria-hidden="true">←</span>
        My tickets
      </Link>
    </div>
  );
}
