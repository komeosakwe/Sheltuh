import TicketQr from "@/components/tickets/TicketQr";
import UBarcode from "@/components/tickets/UBarcode";
import { formatMessageTime } from "@/lib/format";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";

interface TicketStubProps {
  code: string;
  typeName: string;
  /** Its place in the order ("Ticket 2 of 3"), numbered as in the ticket email. Shown only when the order has more than one. */
  ticketNumber?: number;
  ticketCount?: number;
  /** The event, so each ticket stands on its own (a screenshot of one ticket says what it's for). */
  eventTitle?: string;
  /** When, already formatted: "Sat 6 Mar, 8:00 pm – 11:00 pm". */
  when?: string;
  /** Where: the venue name and suburb, "The Cellar Door, Fitzroy". */
  where?: string;
  /** When the ticket was checked in at the door (ISO), or null/unset if it hasn't been. */
  checkedInAt?: string | null;
}

/**
 * One issued ticket (docs/design/check-in.md §5.B2): its type, the event
 * (name, when, where), the scannable QR, the backup code as text under it,
 * whether it's been checked in, and the decorative ü barcode as the brand
 * mark. A code that isn't a real one gets no QR (TicketQr renders nothing),
 * so only the text code shows.
 *
 * Phones: a header row (type and event; small ü), a perforation, then the
 * QR, code, status and brightness hint centred. From `sm`, the two inner
 * wrappers become `display: contents` so their children sit in one grid:
 * type and event, code, status, hint and a large ü down the left, the QR on
 * the right. The QR's cell stretches the stub's full height (so the
 * perforation does too) and centres the QR in it, however tall the left
 * column grows.
 *
 * A checked-in ticket keeps its QR (an undone check-in makes it valid again,
 * and the door's own answer is what counts); it just says when it went in.
 */
export default function TicketStub({
  code,
  typeName,
  ticketNumber,
  ticketCount,
  eventTitle,
  when,
  where,
  checkedInAt,
}: TicketStubProps) {
  const hasQr = TICKET_CODE_PATTERN.test(code);
  const label =
    ticketNumber !== undefined && ticketCount !== undefined && ticketCount > 1
      ? `Ticket ${ticketNumber} of ${ticketCount} · ${typeName}`
      : typeName;
  const status = checkedInAt
    ? `Checked in ${formatMessageTime(checkedInAt)}`
    : hasQr
      ? "Ready to scan"
      : "Ready to use";
  return (
    <li className="border border-foreground print:break-inside-avoid sm:grid sm:grid-cols-[1fr_auto] sm:grid-rows-[auto_auto_auto_1fr_auto] sm:gap-y-4">
      <div className="flex items-start justify-between gap-3 p-4 sm:contents">
        <div className="flex min-w-0 flex-col gap-1 sm:col-start-1 sm:row-start-1 sm:mx-5 sm:mt-5">
          <p className="eyebrow break-words text-muted">{label}</p>
          {eventTitle && <p className="font-heading text-lg break-words text-foreground">{eventTitle}</p>}
          {when && <p className="text-sm text-foreground">{when}</p>}
          {where && <p className="text-sm break-words text-muted">{where}</p>}
        </div>
        <UBarcode
          code={code}
          className="h-12 w-auto shrink-0 sm:col-start-1 sm:row-start-5 sm:mx-5 sm:mb-5 sm:h-28 sm:self-end sm:justify-self-start"
        />
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-dashed border-foreground p-4 sm:contents">
        {hasQr && (
          <div className="sm:col-start-2 sm:row-span-5 sm:row-start-1 sm:flex sm:items-center sm:border-l sm:border-dashed sm:border-foreground sm:p-5">
            <TicketQr code={code} />
          </div>
        )}
        <div className="flex flex-col items-center gap-1 sm:col-start-1 sm:row-start-2 sm:mx-5 sm:items-start">
          <p className="eyebrow text-muted">{hasQr ? "Backup code" : "Entry code"}</p>
          <p className="select-all break-all text-center font-mono text-xl tracking-wider sm:text-left sm:text-2xl sm:tracking-widest">
            {code}
          </p>
        </div>
        <p className="text-center text-sm font-semibold text-foreground sm:col-start-1 sm:row-start-3 sm:mx-5 sm:text-left">
          {status}
        </p>
        {hasQr && !checkedInAt && (
          <p className="text-center text-xs text-muted print:hidden sm:col-start-1 sm:row-start-4 sm:mx-5 sm:text-left">
            Turn your brightness up at the door.
          </p>
        )}
      </div>
    </li>
  );
}
