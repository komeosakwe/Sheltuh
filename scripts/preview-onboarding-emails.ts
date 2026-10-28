/**
 * Renders the three welcome emails (member, organiser approved and pending,
 * organiser next steps) and, for comparison, the ticket email on the shared
 * layout (lib/server/email-layout.ts), then screenshots each with Playwright's
 * Chromium. Sends nothing and touches no service.
 *
 *   node --import tsx scripts/preview-onboarding-emails.ts [--out=dir] [siteUrl]
 *
 * Per welcome email, full page: 320, 375 and 680px wide; 375px with images
 * blocked (each image shows its alt text); and 375px with every face forced to
 * Arial, as a client without Nunito shows it. The ticket email: 375px.
 * `cid:` images, the footer banner and the Nunito file are swapped for local
 * files (nothing is fetched). A browser isn't an email client: check real
 * clients before trusting the layout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EmailMessage } from "../lib/server/email";
import { EMAIL_FONT_PATH, EMAIL_FOOTER_IMAGE_PATH, emailFooterImageUrl } from "../lib/server/email-layout";
import { buildMemberWelcomeEmail, buildOrganiserNextStepsEmail, buildOrganiserWelcomeEmail } from "../lib/server/onboarding-email";
import { buildTicketEmail } from "../lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "../lib/server/types";

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="));
const siteUrl = args.find((a) => !a.startsWith("--")) ?? "https://sheltuh.com.au";
const outDir = outArg ? path.resolve(outArg.slice("--out=".length)) : path.join(tmpdir(), "sheltuh-email-previews");
const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";

const emails: Record<string, EmailMessage> = {
  "member-welcome": buildMemberWelcomeEmail({ to: "a@example.com", firstName: "Maya", siteUrl }),
  "organiser-welcome-approved": buildOrganiserWelcomeEmail({ to: "a@example.com", firstName: "Maya", status: "approved", siteUrl }),
  "organiser-welcome-pending": buildOrganiserWelcomeEmail({ to: "a@example.com", firstName: "Maya", status: "pending", siteUrl }),
  "organiser-next-steps": buildOrganiserNextStepsEmail({ to: "a@example.com", firstName: "Maya", siteUrl }),
};

const event = {
  eventId: "00000000-0000-4000-8000-00000000e001",
  title: "After Hours: Art & Sound",
  venueName: "Northside Studio",
  venueAddress: "88 Smith Street, Collingwood VIC 3066",
  suburb: "Collingwood",
  startsAt: "2026-11-20T08:00:00.000Z",
  endsAt: "2026-11-20T12:00:00.000Z",
  status: "published",
} as EventRecord;
const order = {
  orderId: "ord_7c1f2e0a5b3d4f6e9a182d4c6b8e0f13",
  buyerEmail: "fan@example.com",
  totalCents: 3500,
  tickets: [{ ticketCode: "K7QM-2XPD", ticketTypeId: "t", ticketTypeName: "General admission" }],
} as OrderRecord;
const ticket = buildTicketEmail(order, event, siteUrl);

const dataUri = (file: string, type: string) => `data:${type};base64,${readFileSync(file).toString("base64")}`;

/** Self-contained HTML: cid images inlined, the site's banner and font from local files. */
function local(email: EmailMessage): string {
  let html = email.html;
  for (const image of email.inlineImages ?? []) {
    html = html.replaceAll(`cid:${image.cid}`, `data:${image.contentType};base64,${image.content.toString("base64")}`);
  }
  const banner = emailFooterImageUrl(siteUrl);
  if (banner) html = html.replaceAll(banner, dataUri(path.join(process.cwd(), `public${EMAIL_FOOTER_IMAGE_PATH}`), "image/png"));
  return html.replaceAll(new URL(EMAIL_FONT_PATH, siteUrl).href, `file://${path.join(process.cwd(), "public", EMAIL_FONT_PATH)}`);
}

const blocked = (html: string) => html.replace(/<img src="[^"]*"/g, '<img src=""');
const arial = (html: string) => html.replace("</head>", "<style>* { font-family: Arial !important; }</style></head>");

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {});
  const written: string[] = [];
  const overflows: string[] = [];
  const shoot = async (name: string, html: string, width: number) => {
    const file = path.join(outDir, `${name}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(`file://${file}`);
    await page.evaluate(() => document.fonts.ready);
    if ((await page.evaluate(() => document.documentElement.scrollWidth)) > width) overflows.push(`${name} at ${width}px`);
    const png = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: png, fullPage: true });
    await page.close();
    written.push(png);
  };
  try {
    for (const [name, email] of Object.entries(emails)) {
      writeFileSync(path.join(outDir, `${name}.txt`), email.text);
      const html = local(email);
      for (const width of [320, 375, 680]) await shoot(`${name}-${width}`, html, width);
      await shoot(`${name}-375-images-blocked`, blocked(html), 375);
      await shoot(`${name}-375-arial`, arial(html), 375);
    }
    await shoot("ticket-email-375", local(ticket), 375);
  } finally {
    await browser.close();
  }
  console.log(overflows.length ? `Horizontal overflow:\n  ${overflows.join("\n  ")}` : "No horizontal overflow at any width.");
  console.log(written.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
