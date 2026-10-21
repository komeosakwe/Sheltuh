import TicketQr from "@/components/tickets/TicketQr";
import UBarcode from "@/components/tickets/UBarcode";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";

interface TicketStubProps {
  code: string;
  typeName: string;
  /** Its place in the order ("Ticket 2 of 3"), numbered as in the ticket email. Shown only when the order has more than one. */
  ticketNumber?: number;
  ticketCount?: number;
}

/**
 * One issued ticket (docs/design/check-in.md §5.B2): its type, the scannable
 * QR, the code as text under it, and the decorative ü barcode as the brand
 * mark. A code that isn't a real one gets no QR (TicketQr renders nothing),
 * so only the text code shows.
 *
 * Phones: a header row (type, small ü), a perforation, then the QR, code and
 * brightness hint centred. From `sm`, the two inner wrappers become
 * `display: contents` so their children sit in one grid: type, code, hint and
 * a large ü down the left, the QR on the right. The QR's cell stretches the
 * stub's full height (so the perforation does too) and centres the QR in it,
 * however tall the left column grows.
 */
export default function TicketStub({ code, typeName, ticketNumber, ticketCount }: TicketStubProps) {
  const hasQr = TICKET_CODE_PATTERN.test(code);
  const label =
    ticketNumber !== undefined && ticketCount !== undefined && ticketCount > 1
      ? `Ticket ${ticketNumber} of ${ticketCount} · ${typeName}`
      : typeName;
  return (
    <li className="overflow-hidden rounded-card border border-foreground bg-card print:break-inside-avoid sm:grid sm:grid-cols-[1fr_auto] sm:grid-rows-[auto_auto_1fr_auto] sm:gap-y-4">
      <div className="flex items-start justify-between gap-3 p-4 sm:contents">
        <p className="eyebrow min-w-0 break-words text-muted sm:col-start-1 sm:row-start-1 sm:mx-5 sm:mt-5">{label}</p>
        <UBarcode
          code={code}
          className="h-12 w-auto shrink-0 sm:col-start-1 sm:row-start-4 sm:mx-5 sm:mb-5 sm:h-28 sm:self-end sm:justify-self-start"
        />
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-dashed border-foreground p-4 sm:contents">
        {hasQr && (
          <div className="sm:col-start-2 sm:row-span-4 sm:row-start-1 sm:flex sm:items-center sm:border-l sm:border-dashed sm:border-foreground sm:p-5">
            <TicketQr code={code} />
          </div>
        )}
        <p className="select-all break-all text-center font-mono text-xl tracking-wider sm:col-start-1 sm:row-start-2 sm:mx-5 sm:text-left sm:text-2xl sm:tracking-widest">
          {code}
        </p>
        {hasQr && (
          <p className="text-center text-xs text-muted print:hidden sm:col-start-1 sm:row-start-3 sm:mx-5 sm:text-left">
            Turn your brightness up at the door.
          </p>
        )}
      </div>
    </li>
  );
}
