/**
 * Writes the ticket confirmation email to local HTML/text files with synthetic
 * (fictional) data, for eyeballing in a browser, plus one of each other
 * transactional email (free-ticket confirmation, waitlist, follower) so the
 * shared brand layout (lib/server/email-layout.ts) can be compared side by
 * side. Sends nothing and touches no service.
 *
 *   node --import tsx scripts/preview-ticket-email.ts [siteUrl] [--out=dir] [--screenshots]
 *
 * Output: email-previews/*.html and *.txt (git-ignored), or `--out`'s
 * directory. `siteUrl` (default https://sheltuh.com.au) is used for the links
 * and the event image's URL (the email only shows an event image on an https
 * site). The preview is self-contained: a browser can't resolve the real
 * email's `cid:` images (the wordmark and each ticket's QR), and the remote
 * ones (the footer image and the event image, both on the site's origin)
 * aren't fetched, so each is swapped for a data URI of a local file: the same
 * PNGs for the `cid:` images, public/brand/sheltuh-email-footer.png for the
 * footer, and a sample photo from public/events/ for the event image.
 * qr-svg.html shows the SVG version (lib/ticket-qr.ts `ticketQrSvgPath`, as
 * the ticket page draws it) beside the PNG. email-preview.html is the
 * multiple-tickets scenario.
 *
 * `--screenshots` also saves full-page screenshots of every ticket email and
 * the free-ticket confirmation at 680px, 375px and 320px wide
 * (`<name>-<width>.png`), plus the multiple-tickets email with images blocked
 * (email-preview-375-no-images.png), with Playwright's Chromium, and reports
 * any page wider than its viewport (horizontal overflow). A browser isn't an
 * email client: check real clients before trusting the layout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EmailMessage } from "../lib/server/email";
import { EMAIL_FOOTER_IMAGE_PATH, emailFooterImageUrl, PAGE } from "../lib/server/email-layout";
import { buildFollowerNewEventsEmail } from "../lib/server/follower-email";
import { buildFreeConfirmationEmail } from "../lib/server/free-confirmation-email";
import { buildTicketEmail } from "../lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "../lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "../lib/server/waitlist-email";
import { ticketQrLabel, ticketQrMatrix, ticketQrSvgPath } from "../lib/ticket-qr";

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="));
const screenshots = args.includes("--screenshots");
const siteUrl = args.find((a) => !a.startsWith("--")) ?? "https://sheltuh.com.au";
const outDir = outArg ? path.resolve(outArg.slice("--out=".length)) : path.join(process.cwd(), "email-previews");

/** A fictional event's image path, the shape the API gives it (records.ts EVENT_COLUMNS). */
const PREVIEW_IMAGE_PATH = "/api/events/00000000-0000-4000-8000-00000000e001/image?v=1";
/** The local photo the preview shows in its place. */
const PREVIEW_PHOTO = path.join(process.cwd(), "public/events/record-shop-dj.jpg");

const baseEvent = {
  eventId: "00000000-0000-4000-8000-00000000e001",
  title: "After Hours: Art & Sound",
  venueName: "Northside Studio",
  venueAddress: "88 Smith Street, Collingwood VIC 3066",
  suburb: "Collingwood",
  startsAt: "2026-11-20T08:00:00.000Z", // 7:00 pm AEDT
  endsAt: "2026-11-20T12:00:00.000Z", // 11:00 pm AEDT
  status: "published",
  imageUrl: PREVIEW_IMAGE_PATH,
} as EventRecord;
const noImage = { ...baseEvent, imageUrl: undefined } as EventRecord;

const ticket = (code: string, typeName = "General admission", seat?: OrderRecord["tickets"][number]["seat"]) => ({
  ticketCode: code,
  ticketTypeId: "t",
  ticketTypeName: typeName,
  ...(seat ? { seat } : {}),
});
const baseOrder = (tickets: ReturnType<typeof ticket>[], totalCents: number) =>
  ({ orderId: "ord_7c1f2e0a5b3d4f6e9a182d4c6b8e0f13", buyerEmail: "fan@example.com", totalCents, tickets }) as OrderRecord;

const scenarios: Record<string, { order: OrderRecord; event: EventRecord }> = {
  "1-single-paid": { order: baseOrder([ticket("K7QM-2XPD")], 3500), event: baseEvent },
  "2-multiple-types": {
    order: baseOrder([ticket("K7QM-2XPD"), ticket("R4TN-9WJC", "Early bird"), ticket("B8VF-3HLZ", "VIP"), ticket("M2GD-6SYA")], 11690),
    event: baseEvent,
  },
  "3-free-ticket": {
    order: baseOrder([ticket("H6WP-4KTE", "RSVP")], 0),
    event: { ...baseEvent, title: "Sunday Sketch Club", venueName: "Abbotsford Convent", venueAddress: "1 St Heliers Street, Abbotsford VIC 3067" } as EventRecord,
  },
  "4-long-names": {
    order: baseOrder([ticket("K7QM-2XPD", "General admission with a very long ticket type name that wraps onto several lines")], 3500),
    event: {
      ...baseEvent,
      title: "The Extraordinarily Long Titled Night of Experimental Sound, Light and Fermented Things (Melbourne Edition)",
      venueName: "The Old Melbourne Gaol Annex and Collingwood Warehouse Artists' Cooperative",
      venueAddress: "Level 3, Building C, 1234-1240 Extraordinarily Long Street Name Road, North Fitzroy VIC 3068, Australia",
    } as EventRecord,
  },
  "5-no-image": { order: baseOrder([ticket("K7QM-2XPD"), ticket("R4TN-9WJC")], 7000), event: noImage },
  "6-overnight": {
    order: baseOrder([ticket("K7QM-2XPD")], 2338),
    event: { ...baseEvent, title: "Midnight Tape Club", startsAt: "2027-03-05T12:00:00.000Z", endsAt: "2027-03-05T16:30:00.000Z" } as EventRecord,
  },
  // Across the end of daylight saving (4 April 2027): each end keeps its own zone.
  "6b-multi-day-dst": {
    order: baseOrder([ticket("K7QM-2XPD", "Weekend pass"), ticket("R4TN-9WJC", "Weekend pass")], 24000),
    event: { ...baseEvent, title: "Overnight Warehouse Weekender", startsAt: "2027-04-02T09:00:00.000Z", endsAt: "2027-04-04T06:00:00.000Z" } as EventRecord,
  },
  "7-missing-optional-info": {
    order: baseOrder([ticket("K7QM-2XPD", "")], 0),
    event: { ...noImage, venueName: "Secret location", venueAddress: "", suburb: "" } as EventRecord,
  },
  "8-html-in-text": {
    order: baseOrder([ticket("A<B>-\"1\"&")], 1000),
    event: { ...noImage, title: `<script>alert("x")</script> & Friends`, venueName: "<b>Venue</b>" } as EventRecord,
  },
  "9-event-no-longer-listed": {
    order: baseOrder([ticket("K7QM-2XPD")], 2338),
    event: { ...baseEvent, status: "draft" } as EventRecord,
  },
  "10-seated": {
    order: baseOrder(
      [
        ticket("K7QM-2XPD", "Stalls", { section: "Stalls", row: "F", seat: "12", kind: "standard" }),
        ticket("R4TN-9WJC", "Stalls", { section: "Stalls", row: "F", seat: "13", kind: "standard" }),
      ],
      9800,
    ),
    event: baseEvent,
  },
};

/** A local file as a data URI. */
function fileDataUri(file: string, type: string): string {
  return `data:${type};base64,${readFileSync(file).toString("base64")}`;
}

/** The email's HTML with every `cid:` image inlined as a data URI. */
function withDataUris(email: EmailMessage): string {
  let html = email.html;
  for (const image of email.inlineImages ?? []) {
    html = html.replaceAll(`cid:${image.cid}`, `data:${image.contentType};base64,${image.content.toString("base64")}`);
  }
  // The remote images, from local files (nothing is fetched).
  const footerUrl = emailFooterImageUrl(siteUrl);
  if (footerUrl) html = html.replaceAll(footerUrl, fileDataUri(path.join(process.cwd(), `public${EMAIL_FOOTER_IMAGE_PATH}`), "image/png"));
  html = html.replaceAll(new URL(PREVIEW_IMAGE_PATH, siteUrl).href.replaceAll("&", "&#38;"), fileDataUri(PREVIEW_PHOTO, "image/jpeg"));
  return html;
}

/** The SVG QR next to the email's PNG, for comparing the two renderings. */
function qrSvgPage(code: string, email: EmailMessage): string {
  const matrix = ticketQrMatrix(code);
  if (!matrix) throw new Error(`${code} isn't a ticket code`);
  const { d, size } = ticketQrSvgPath(matrix);
  const png = email.inlineImages?.find((image) => image.cid.startsWith("ticket-qr-"));
  const pngTag = png ? `<img src="data:${png.contentType};base64,${png.content.toString("base64")}" width="232" height="232" alt="PNG">` : "";
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><title>QR ${code}</title></head>
<body style="font-family:sans-serif;background:${PAGE};padding:24px">
<p>SVG (ticketQrSvgPath) and the email's PNG for ${code}</p>
<svg role="img" aria-label="${ticketQrLabel(code)}" viewBox="0 0 ${size} ${size}" width="232" height="232" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>
${pngTag}
</body></html>`;
}

/** The email's HTML as a client blocking images shows it: each image's box with its alt text. */
function imagesBlocked(email: EmailMessage): string {
  return email.html.replace(/<img src="[^"]*"/g, '<img src=""');
}

// The other emails, in the same layout (lib/server/email-layout.ts).
const otherEvent = { ...baseEvent, slug: "after-hours-art-and-sound" } as EventRecord;
const others: Record<string, EmailMessage> = {
  "11-free-confirmation": buildFreeConfirmationEmail(
    "fan@example.com",
    otherEvent,
    [{ ticketTypeId: "t", ticketTypeName: "General admission", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 2 }],
    `${siteUrl}/checkout/confirm#token=preview`,
    24,
  ),
  "12-waitlist-confirmation": buildWaitlistConfirmationEmail("fan@example.com", otherEvent, `${siteUrl}/waitlist/confirm#token=preview`, 24),
  "13-waitlist-available": buildWaitlistAvailableEmail(
    "fan@example.com",
    otherEvent,
    `${siteUrl}/events/after-hours-art-and-sound#tickets`,
    `${siteUrl}/waitlist/leave#token=preview`,
  ),
  "14-follower-new-events": buildFollowerNewEventsEmail({
    to: "fan@example.com",
    organiserName: "Cellar Door Sound",
    organiserId: "org_preview",
    events: [otherEvent],
    total: 1,
    siteUrl,
    unsubscribeLink: `${siteUrl}/following/unsubscribe#token=preview`,
  }),
};

const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";

/** Full-page screenshots at each width; returns the widths at which the page overflows horizontally. */
async function screenshots_(htmlFile: string, widths: number[], name: string): Promise<string[]> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {});
  const overflows: string[] = [];
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlFile}`);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > width) overflows.push(`${name} at ${width}px: ${scrollWidth}px wide`);
      await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return overflows;
}

const WIDTHS = [680, 375, 320];

async function main() {
  mkdirSync(outDir, { recursive: true });
  let written = 0;
  const htmlFiles: Record<string, string> = {};
  for (const [name, { order, event }] of Object.entries(scenarios)) {
    const email = buildTicketEmail(order, event, siteUrl);
    htmlFiles[name] = path.join(outDir, `${name}.html`);
    writeFileSync(htmlFiles[name], withDataUris(email));
    writeFileSync(path.join(outDir, `${name}.txt`), email.text);
    written += 2;
  }
  for (const [name, email] of Object.entries(others)) {
    htmlFiles[name] = path.join(outDir, `${name}.html`);
    writeFileSync(htmlFiles[name], withDataUris(email));
    writeFileSync(path.join(outDir, `${name}.txt`), email.text);
    written += 2;
  }
  const sample = scenarios["1-single-paid"];
  writeFileSync(path.join(outDir, "qr-svg.html"), qrSvgPage("K7QM-2XPD", buildTicketEmail(sample.order, sample.event, siteUrl)));
  const preview = scenarios["2-multiple-types"];
  const previewEmail = buildTicketEmail(preview.order, preview.event, siteUrl);
  const previewFile = path.join(outDir, "email-preview.html");
  writeFileSync(previewFile, withDataUris(previewEmail));
  const blockedFile = path.join(outDir, "email-preview-no-images.html");
  writeFileSync(blockedFile, imagesBlocked(previewEmail));
  written += 3;
  if (screenshots) {
    const overflows: string[] = [];
    for (const name of [...Object.keys(scenarios), "11-free-confirmation"]) {
      overflows.push(...(await screenshots_(htmlFiles[name], WIDTHS, name)));
      written += WIDTHS.length;
    }
    overflows.push(...(await screenshots_(blockedFile, [375], "email-preview-no-images")));
    written += 1;
    console.log(overflows.length ? `Horizontal overflow:\n  ${overflows.join("\n  ")}` : "No horizontal overflow at any width.");
  }
  console.log(`Wrote ${written} files to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
