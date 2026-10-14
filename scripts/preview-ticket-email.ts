/**
 * Writes the ticket confirmation email to local HTML/text files with synthetic
 * data, for eyeballing in a browser. Sends nothing and touches no service.
 *
 *   node --import tsx scripts/preview-ticket-email.ts [siteUrl]
 *
 * Output: email-previews/*.html and *.txt (git-ignored). The logo is loaded
 * from `siteUrl` (default http://127.0.0.1:3111, the local dev server).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTicketEmail } from "../lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "../lib/server/types";

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

mkdirSync(outDir, { recursive: true });
for (const [name, { order, event }] of Object.entries(scenarios)) {
  const email = buildTicketEmail(order, event, siteUrl);
  writeFileSync(path.join(outDir, `${name}.html`), email.html);
  writeFileSync(path.join(outDir, `${name}.txt`), email.text);
}
console.log(`Wrote ${Object.keys(scenarios).length * 2} files to ${outDir}`);
