"use client";

import { useState } from "react";
import Sheet, { SheetRow, SheetRows } from "@/components/ui/Sheet";
import { formatAudExact } from "@/lib/format";
import { SUPPORT_LABEL } from "@/lib/support";

/*
 * The My ticket page's dialogs (from 768) and bottom sheets (below), as
 * Latte's 1120 frames draw them. Each takes plain props: the page works out
 * the links and words, so these know nothing about orders.
 */

interface OpenProps {
  open: boolean;
  onClose: () => void;
}

export interface CalendarLinks {
  /** Google's and Outlook's prefilled "new event" pages. */
  google: string;
  outlook: string;
  /** The event's .ics on this site, and the name to save it under. */
  ics: string;
  icsName: string;
}

/** Add to calendar: a three-row list (the frames, not the handoff's row of buttons). */
export function AddToCalendarSheet({
  open,
  onClose,
  subtitle,
  links,
}: OpenProps & {
  /** "Here & Now · Sat 14 Nov, 5–9 pm". */
  subtitle: string;
  links: CalendarLinks;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add to calendar" subtitle={subtitle} dismissLabel="Cancel">
      <SheetRows>
        <SheetRow title="Google Calendar" mark="›" href={links.google} newTab />
        <SheetRow title="Apple Calendar" sub="Downloads an .ics file" mark="›" href={links.ics} download={links.icsName} />
        <SheetRow title="Outlook" mark="›" href={links.outlook} newTab />
      </SheetRows>
    </Sheet>
  );
}

/**
 * Directions: the venue's name and address, Apple Maps, Google Maps, and
 * Copy address. Copying says "Address copied" (or that it couldn't) in a
 * polite status, which is always in the sheet so the words are announced.
 */
export function DirectionsSheet({
  open,
  onClose,
  venueName,
  address,
  copyText,
  appleHref,
  googleHref,
}: OpenProps & {
  venueName: string;
  /** The address as shown on the page; also what Copy address copies (the venue's name alone without one), unless `copyText` says otherwise. */
  address: string;
  /** What Copy address copies, when the title and address shown aren't it on their own (a venue with no name: its street is the title). */
  copyText?: string;
  appleHref: string | null;
  googleHref: string | null;
}) {
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const text = copyText || address || venueName;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      // No clipboard (an insecure page, or permission refused): say so, and the address is on the sheet to copy by hand.
      setCopied("failed");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        setCopied("");
        onClose();
      }}
      title={venueName}
      subtitle={address || undefined}
      dismissLabel="Cancel"
    >
      <SheetRows>
        {appleHref && <SheetRow title="Apple Maps" mark="↗" href={appleHref} newTab />}
        {googleHref && <SheetRow title="Google Maps" mark="↗" href={googleHref} newTab />}
        <SheetRow title="Copy address" onClick={() => void copy()} />
      </SheetRows>
      <p role="status" className="body-s text-muted empty:hidden">
        {copied === "copied" ? "Address copied" : copied === "failed" ? "Couldn’t copy. Select the address above instead." : ""}
      </p>
    </Sheet>
  );
}

export interface ReceiptAmounts {
  subtotalCents: number;
  buyerFeeCents: number;
  /** Support Sheltüh, when the buyer added some. */
  supportCents?: number;
  totalCents: number;
}

/**
 * The order's receipt: its lines, the booking fee, any Support Sheltüh and
 * the total paid (all from the order; the page has no other amounts), to
 * the cent as a receipt is.
 * `ticketsLabel` is the first line's name: "1 × Second release" when the
 * order is one kind of ticket, "Ticket subtotal" otherwise.
 */
export function OrderReceiptSheet({
  open,
  onClose,
  reference,
  ticketsLabel,
  amounts,
}: OpenProps & {
  /** "#A90133C9". */
  reference: string;
  ticketsLabel: string;
  amounts: ReceiptAmounts;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`Order ${reference}`} dismissLabel="Close">
      <dl className="body-m flex flex-col gap-2">
        <div className="flex justify-between gap-4">
          <dt className="text-foreground">{ticketsLabel}</dt>
          <dd className="text-foreground tabular-nums">{formatAudExact(amounts.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-foreground">Booking fee</dt>
          <dd className="text-foreground tabular-nums">{formatAudExact(amounts.buyerFeeCents)}</dd>
        </div>
        {/* Only when they added some; it's in the total paid. */}
        {amounts.supportCents !== undefined && amounts.supportCents > 0 && (
          <div className="flex justify-between gap-4" data-support-line="">
            <dt className="text-foreground">{SUPPORT_LABEL}</dt>
            <dd className="text-foreground tabular-nums">{formatAudExact(amounts.supportCents)}</dd>
          </div>
        )}
        <div className="mt-1 flex justify-between gap-4 border-t border-surface-border pt-3 font-semibold">
          <dt className="text-foreground">Total paid</dt>
          <dd className="text-foreground tabular-nums">{formatAudExact(amounts.totalCents)}</dd>
        </div>
      </dl>
      {amounts.supportCents !== undefined && amounts.supportCents > 0 && (
        <p className="body-s text-foreground">Thanks for supporting Sheltüh.</p>
      )}
    </Sheet>
  );
}

export interface ManageOrderRow {
  title: string;
  sub?: string;
  /** A link when set; otherwise a button calling `onClick`. The sheet closes first either way. */
  href?: string;
  onClick?: () => void;
}

/**
 * Manage order: the rows the page gives it (only actions that work today;
 * the frames' other rows join as their features land), then the refund note.
 */
export function ManageOrderSheet({
  open,
  onClose,
  subtitle,
  rows,
  note,
}: OpenProps & {
  /** "Order #A90133C9 · 1 ticket". */
  subtitle: string;
  rows: ManageOrderRow[];
  /** The refund terms, under the rows. */
  note?: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Manage order" subtitle={subtitle} dismissLabel="Close">
      <SheetRows>
        {rows.map((row) => (
          <SheetRow
            key={row.title}
            title={row.title}
            sub={row.sub}
            mark="›"
            href={row.href}
            onClick={() => {
              onClose();
              row.onClick?.();
            }}
          />
        ))}
      </SheetRows>
      {note && <p className="text-xs leading-4 font-medium text-muted">{note}</p>}
    </Sheet>
  );
}
