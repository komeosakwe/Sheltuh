/**
 * Writes the ticket confirmation email to local HTML/text files with synthetic
 * data, for eyeballing in a browser, plus one of each other transactional
 * email (free-ticket confirmation, waitlist, follower) so the shared brand
 * layout (lib/server/email-layout.ts) can be compared side by side. Sends
 * nothing and touches no service.
 *
 *   node --import tsx scripts/preview-ticket-email.ts [siteUrl]
 *
 * Output: email-previews/*.html and *.txt (git-ignored). The logo is loaded
 * from `siteUrl` (default http://127.0.0.1:3111, the local dev server). The
 * real email shows each ticket's QR as an inline attachment (`cid:`), which a
 * browser can't resolve, so the preview swaps each `cid:` for a data URI of
 * the same PNG. qr-svg.html shows the SVG version (lib/ticket-qr.ts
 * `ticketQrSvgPath`, as the ticket page draws it) beside the PNG.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EmailMessage } from "../lib/server/email";
import { CREAM } from "../lib/server/email-layout";
import { buildFollowerNewEventsEmail } from "../lib/server/follower-email";
import { buildFreeConfirmationEmail } from "../lib/server/free-confirmation-email";
import { buildTicketEmail } from "../lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "../lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "../lib/server/waitlist-email";
import { ticketQrLabel, ticketQrMatrix, ticketQrSvgPath } from "../lib/ticket-qr";

const siteUrl = process.argv[2] ?? "http://127.0.0.1:3111";
const outDir = path.join(process.cwd(), "email-previews");

const baseEvent = {
  title: "Neon Static",
  venueName: "The Cellar Door",
  venueAddress: "12 Hosier Lane, Melbourne VIC 3000",
  startsAt: "2027-03-06T09:00:00.000Z", // 8:00 pm AEDT
  endsAt: "2027-03-06T13:00:00.000Z",
} as EventRecord;

const ticket = (code: string, typeName = "General admission") => ({ ticketCode: code, ticketTypeId: "t", ticketTypeName: typeName });
const baseOrder = (tickets: ReturnType<typeof ticket>[], totalCents: number) =>
  ({ orderId: "7c1f2e0a-5b3d-4f6e-9a18-2d4c6b8e0f13", buyerEmail: "fan@example.com", totalCents, tickets }) as OrderRecord;

const scenarios: Record<string, { order: OrderRecord; event: EventRecord }> = {
  "1-one-ticket": { order: baseOrder([ticket("K7QM-2XPD")], 2338), event: baseEvent },
  "2-multiple-tickets": {
    order: baseOrder([ticket("K7QM-2XPD"), ticket("R4TN-9WJC", "Early bird"), ticket("B8VF-3HLZ", "VIP"), ticket("M2GD-6SYA")], 11690),
    event: baseEvent,
  },
  "3-long-names": {
    order: baseOrder([ticket("K7QM-2XPD", "General admission with a very long ticket type name that wraps onto several lines")], 3500),
    event: {
      ...baseEvent,
      title: "The Extraordinarily Long Titled Night of Experimental Sound, Light and Fermented Things (Melbourne Edition)",
      venueName: "The Old Melbourne Gaol Annex and Collingwood Warehouse Artists' Cooperative",
      venueAddress: "Level 3, Building C, 1234-1240 Extraordinarily Long Street Name Road, North Fitzroy VIC 3068, Australia",
    } as EventRecord,
  },
  "4-overnight-and-multiday": {
    order: baseOrder([ticket("K7QM-2XPD", "Weekend pass"), ticket("R4TN-9WJC", "Weekend pass")], 24000),
    event: { ...baseEvent, title: "Overnight Warehouse Weekender", startsAt: "2027-03-05T10:00:00.000Z", endsAt: "2027-03-07T05:00:00.000Z" } as EventRecord,
  },
  "4b-overnight-one-night": {
    order: baseOrder([ticket("K7QM-2XPD")], 0),
    event: { ...baseEvent, title: "Midnight Tape Club", startsAt: "2027-03-05T12:00:00.000Z", endsAt: "2027-03-05T16:30:00.000Z" } as EventRecord,
  },
  "5-missing-optional-info": {
    order: baseOrder([ticket("K7QM-2XPD", "")], 0),
    event: { ...baseEvent, venueName: "", venueAddress: "" } as EventRecord,
  },
  "6-html-in-text": {
    order: baseOrder([ticket("A<B>-\"1\"&")], 1000),
    event: { ...baseEvent, title: `<script>alert("x")</script> & Friends`, venueName: "<b>Venue</b>" } as EventRecord,
  },
};

/** The email's HTML with every `cid:` image inlined as a data URI. */
function withDataUris(email: EmailMessage): string {
  let html = email.html;
  for (const image of email.inlineImages ?? []) {
    html = html.replaceAll(`cid:${image.cid}`, `data:${image.contentType};base64,${image.content.toString("base64")}`);
  }
  return html;
}

/** The SVG QR next to the email's PNG, for comparing the two renderings. */
function qrSvgPage(code: string, email: EmailMessage): string {
  const matrix = ticketQrMatrix(code);
  if (!matrix) throw new Error(`${code} isn't a ticket code`);
  const { d, size } = ticketQrSvgPath(matrix);
  const png = email.inlineImages?.[0];
  const pngTag = png ? `<img src="data:${png.contentType};base64,${png.content.toString("base64")}" width="174" height="174" alt="PNG">` : "";
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>QR ${code}</title></head>
<body style="font-family:sans-serif;background:${CREAM};padding:24px">
<p>SVG (ticketQrSvgPath) and the email's PNG for ${code}</p>
<svg role="img" aria-label="${ticketQrLabel(code)}" viewBox="0 0 ${size} ${size}" width="174" height="174" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>
${pngTag}
</body></html>`;
}

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const [name, { order, event }] of Object.entries(scenarios)) {
  const email = buildTicketEmail(order, event, siteUrl);
  writeFileSync(path.join(outDir, `${name}.html`), withDataUris(email));
  writeFileSync(path.join(outDir, `${name}.txt`), email.text);
  written += 2;
}
// The other emails, in the same layout.
const otherEvent = { ...baseEvent, slug: "neon-static", suburb: "Melbourne" } as EventRecord;
const others: Record<string, EmailMessage> = {
  "7-free-confirmation": buildFreeConfirmationEmail(
    "fan@example.com",
    otherEvent,
    [{ ticketTypeId: "t", ticketTypeName: "General admission", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 2 }],
    `${siteUrl}/checkout/confirm#token=preview`,
    24,
  ),
  "8-waitlist-confirmation": buildWaitlistConfirmationEmail("fan@example.com", otherEvent, `${siteUrl}/waitlist/confirm#token=preview`, 24),
  "9-waitlist-available": buildWaitlistAvailableEmail(
    "fan@example.com",
    otherEvent,
    `${siteUrl}/events/neon-static#tickets`,
    `${siteUrl}/waitlist/leave#token=preview`,
  ),
  "10-follower-new-events": buildFollowerNewEventsEmail({
    to: "fan@example.com",
    organiserName: "Cellar Door Sound",
    organiserId: "org_preview",
    events: [otherEvent],
    total: 1,
    siteUrl,
    unsubscribeLink: `${siteUrl}/following/unsubscribe#token=preview`,
  }),
};
for (const [name, email] of Object.entries(others)) {
  writeFileSync(path.join(outDir, `${name}.html`), email.html);
  writeFileSync(path.join(outDir, `${name}.txt`), email.text);
  written += 2;
}
const sample = scenarios["1-one-ticket"];
writeFileSync(path.join(outDir, "qr-svg.html"), qrSvgPage("K7QM-2XPD", buildTicketEmail(sample.order, sample.event, siteUrl)));
written += 1;
console.log(`Wrote ${written} files to ${outDir}`);
