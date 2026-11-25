/**
 * Writes the five ticket transfer emails (lib/server/ticket-transfer-email.ts)
 * to local HTML/text files with fictional data, for eyeballing, and with
 * `--screenshots` saves full-page screenshots at 648 px (the 600 frame on
 * its page) and 375 px with Playwright's Chromium. With `--compare=<dir>`
 * (a folder of Latte's frame PNGs, named as the Figma export names them)
 * each screenshot is also put beside its frame: Latte on the left, built on
 * the right, at the same CSS width. Sends nothing and touches no service.
 *
 *   node --import tsx scripts/preview-ticket-transfer-emails.ts [--out=dir] [--screenshots] [--compare=dir]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EmailMessage } from "../lib/server/email";
import {
  buildTransferAcceptedEmail,
  buildTransferBackEmail,
  buildTransferOfferEmail,
  buildTransferTicketEmail,
} from "../lib/server/ticket-transfer-email";
import type { EventRecord } from "../lib/server/types";

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const siteUrl = "https://sheltuh.com.au";
const outDir = path.resolve(arg("out") ?? path.join(process.cwd(), "email-previews/transfers"));
const compareDir = arg("compare");

const PREVIEW_IMAGE_PATH = "/api/events/00000000-0000-4000-8000-00000000e001/image?v=1";
const PREVIEW_PHOTO = path.join(process.cwd(), "public/events/record-shop-dj.jpg");

const event = {
  eventId: "00000000-0000-4000-8000-00000000e001",
  slug: "here-and-now",
  title: "Here & Now",
  venueName: "Interconnect Studio",
  venueAddress: "16 Catherine St",
  suburb: "Coburg North",
  state: "VIC",
  startsAt: "2026-11-14T06:00:00.000Z", // 5:00 pm AEDT
  endsAt: "2026-11-14T10:00:00.000Z", // 9:00 pm AEDT
  status: "published",
  imageUrl: PREVIEW_IMAGE_PATH,
  organiserId: "00000000-0000-4000-8000-00000000a001",
  organiserName: "Here & Now Collective",
  // Latte's three lines, as an organiser's rows (each value at most 80 characters).
  beforeYouGo: [
    { label: "Entry", value: "Doors open 5:00 pm · last entry 8:00 pm." },
    { label: "Age", value: "18+ event — bring photo ID that matches the ticket holder name." },
    { label: "Phones", value: "Phone-free night: your phone goes into a locked pouch until you leave." },
  ],
} as EventRecord;

const ORDER = "ord_7c1f2e0a5b3d4f6e9a182d4c6b8e0f13";
const TRANSFER = "3f2b9c4e-8a1d-4f6b-9e0c-7a5d2b8e1f43";

const emails: Record<string, { email: EmailMessage; frame: string }> = {
  "01-offer": {
    email: buildTransferOfferEmail({
      to: "sam@email.com",
      siteUrl,
      token: "preview-token-preview-token-preview-token-x",
      senderName: "Alex Chen",
      event,
      ticket: { typeName: "Second release" },
    }),
    frame: "Ticket-received-sent-by-a-friend",
  },
  "02-accepted": {
    email: buildTransferAcceptedEmail({
      to: "alex@email.com",
      siteUrl,
      orderId: ORDER,
      senderKind: "buyer",
      holderName: "Sam Lee",
      recipientEmail: "sam@email.com",
      acceptedEmail: "sam@email.com",
      maskedAcceptedEmail: "s***@email.com",
      ticketNumber: 1,
      ticketCount: 2,
      event,
    }),
    frame: "Transfer-accepted-to-sender",
  },
  "03-declined": {
    email: buildTransferBackEmail("transfer_declined", {
      to: "alex@email.com",
      siteUrl,
      orderId: ORDER,
      senderKind: "buyer",
      recipientName: "Sam Lee",
      ticketNumber: 1,
      event,
      closed: false,
    }),
    frame: "Transfer-declined-to-sender",
  },
  "04-expired": {
    email: buildTransferBackEmail("transfer_expired", {
      to: "alex@email.com",
      siteUrl,
      orderId: ORDER,
      senderKind: "buyer",
      recipientName: "Sam Lee",
      ticketNumber: 1,
      event,
      closed: false,
    }),
    // Not drawn: built like declined, so compared with that frame.
    frame: "Transfer-declined-to-sender",
  },
  "05-recipient-ticket": {
    email: buildTransferTicketEmail({
      to: "sam@email.com",
      siteUrl,
      transferId: TRANSFER,
      senderName: "Alex Chen",
      code: "BPT7-7P6W",
      event,
      ticket: { typeName: "Second release" },
    }),
    // Not drawn as its own frame: compared with the offer it replaces.
    frame: "Ticket-received-sent-by-a-friend",
  },
};

const dataUri = (file: string, type: string) => `data:${type};base64,${readFileSync(file).toString("base64")}`;

function selfContained(email: EmailMessage): string {
  let html = email.html;
  for (const image of email.inlineImages ?? []) {
    html = html.replaceAll(`cid:${image.cid}`, `data:${image.contentType};base64,${image.content.toString("base64")}`);
  }
  html = html.replace(/https:\/\/sheltuh\.com\.au(\/(?:email|fonts)\/[^'")\s]+)/g, (whole, file: string) => {
    const local = path.join(process.cwd(), "public", file);
    return existsSync(local) ? dataUri(local, file.endsWith(".woff2") ? "font/woff2" : "image/png") : whole;
  });
  return html.replaceAll(new URL(PREVIEW_IMAGE_PATH, siteUrl).href.replaceAll("&", "&#38;"), dataUri(PREVIEW_PHOTO, "image/jpeg"));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const [name, { email }] of Object.entries(emails)) {
    writeFileSync(path.join(outDir, `${name}.html`), selfContained(email));
    writeFileSync(path.join(outDir, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}`);
  }
  if (!args.includes("--screenshots")) return;
  const { chromium } = await import("@playwright/test");
  const pinned = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(existsSync(pinned) ? { executablePath: pinned } : {});
  try {
    for (const [name, { frame }] of Object.entries(emails)) {
      for (const [label, width] of [["desktop-600", 648], ["mobile-375", 375]] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(`file://${path.join(outDir, `${name}.html`)}`);
        await page.waitForLoadState("networkidle");
        const built = path.join(outDir, `${name}-${label}.png`);
        await page.screenshot({ path: built, fullPage: true });
        await page.close();
        if (!compareDir) continue;
        const want = label === "desktop-600" ? "Desktop-600" : "Mobile-375";
        const latte = readdirSync(compareDir).find((f) => f.includes(frame) && f.includes(want));
        if (!latte) continue;
        const pair = await browser.newPage({ viewport: { width: width * 2 + 48, height: 900 } });
        await pair.setContent(
          `<body style="margin:0;background:#ddd;font:600 14px Arial"><table cellspacing="16"><tr>` +
            `<td valign="top">Latte<br><img src="${dataUri(path.join(compareDir, latte), "image/png")}" width="${width}"></td>` +
            `<td valign="top">Built<br><img src="${dataUri(built, "image/png")}" width="${width}"></td>` +
            `</tr></table></body>`,
        );
        await pair.waitForLoadState("networkidle");
        await pair.screenshot({ path: path.join(outDir, `${name}-${label}-side-by-side.png`), fullPage: true });
        await pair.close();
      }
    }
  } finally {
    await browser.close();
  }
}

void main();
