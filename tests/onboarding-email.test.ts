import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeBookingFee } from "@/lib/fees";
import { WHOS_GOING_SUMMARY } from "@/lib/whos-going-copy";
import type { EmailMessage } from "@/lib/server/email";
import { KIT } from "@/lib/server/email-kit";
import { displayHeading, emailFooter, emailFooterText, heroImage, numberedSteps, WORDMARK_CID } from "@/lib/server/email-layout";
import { SANS, TICKET_EMAIL_FONTS } from "@/lib/server/email-ticket-layout";
import { buildMemberWelcomeEmail, buildOrganiserNextStepsEmail, buildOrganiserWelcomeEmail } from "@/lib/server/onboarding-email";

const site = "https://sheltuh.test";
const FONT_STACK = "'Instrument Sans',Arial,Helvetica,sans-serif";
const hostile = `<img src=x onerror=alert(1)> & "Sam"`;

const all: Record<string, (firstName?: string | null) => EmailMessage> = {
  member: (firstName) => buildMemberWelcomeEmail({ to: "a@example.com", firstName, siteUrl: site }),
  organiserApproved: (firstName) => buildOrganiserWelcomeEmail({ to: "a@example.com", firstName, status: "approved", siteUrl: site }),
  organiserPending: (firstName) => buildOrganiserWelcomeEmail({ to: "a@example.com", firstName, status: "pending", siteUrl: site }),
  nextSteps: (firstName) => buildOrganiserNextStepsEmail({ to: "a@example.com", firstName, siteUrl: site }),
};

/** Every route the emails link to must be a page in app/. */
function routeExists(url: string): boolean {
  const { pathname } = new URL(url);
  const dir = path.join(process.cwd(), "app", ...pathname.split("/").filter(Boolean));
  return existsSync(path.join(dir, "page.tsx")) && readdirSync(dir).length > 0;
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

// The welcome and onboarding emails on the shared 1120 layout (lib/server/email-kit.ts). Latte's organiser frames
// (A1 pending welcome, A2 approved welcome, A3 next steps) are covered word for word in
// tests/server/organiser-emails-1120.test.ts; this file holds the invariants every one of them keeps.

/** The greeting word each email uses: Latte's A1 / A2 say "Hi", A3 and the member welcome "Hey". */
const GREETING: Record<string, "Hi" | "Hey"> = { member: "Hey", organiserApproved: "Hi", organiserPending: "Hi", nextSteps: "Hey" };

describe("subjects, headings and copy", () => {
  it("member welcome", () => {
    const e = all.member("Sam");
    expect(e.subject).toBe("Welcome to Sheltüh — find your people");
    expect(e.html).toContain("Find your room.<br><span style=\"color:#ff4800\">Find your people.</span>");
    expect(e.html).toContain("Find something you love. Meet people who love it too.");
    expect(e.html).toContain("Hey Sam,");
    expect(e.html).toContain("Find your next event");
    expect(e.html).toContain("Your kind of thing. Your kind of people.");
    expect(e.html).toContain("See who’s going");
    expect(e.html).toContain(WHOS_GOING_SUMMARY);
    expect(e.text).toContain(WHOS_GOING_SUMMARY);
    for (const n of ["01", "02", "03"]) expect(e.html).toContain(`>${n}</td>`);
    expect(e.html).toContain("You’re receiving this because you created a Sheltüh account.");
    expect(e.text).toContain("You’re receiving this because you created a Sheltüh account.");
  });

  it("organiser welcome: A1 while the application waits, A2 once approved (Latte's subjects and preview text)", () => {
    const approved = all.organiserApproved("Sam");
    const pending = all.organiserPending("Sam");
    expect(pending.subject).toBe("We’ve got your application");
    expect(pending.html).toContain("A person on our team will review it within 2 business days.");
    expect(pending.html).toContain("View your application");
    expect(pending.html).toContain("We review your application");
    expect(pending.html).not.toContain("Introduce yourself");
    expect(approved.subject).toBe("You’re in. Let’s get your first event live");
    expect(approved.html).toContain("You make the space.<br><span style=\"color:#ff4800\">Bring your people together.</span>");
    expect(approved.html).toContain("Open organiser dashboard");
    expect(approved.html).toContain("Introduce yourself");
    expect(approved.html).not.toContain("Thanks for applying");
  });

  it("organiser next steps (A3): five sections, the fee from describeBookingFee, links to real pages", () => {
    const e = all.nextSteps("Sam");
    expect(e.subject).toBe("Before you publish: a few things to know");
    expect(e.html).toContain("A few things to know.");
    expect(e.html).toContain(`(${describeBookingFee()})`);
    expect(e.text).toContain(`(${describeBookingFee()})`);
    for (const n of ["01", "02", "03", "04", "05"]) expect(e.html).toContain(`>${n}</td>`);
    expect(hrefs(e.html).filter((h) => h.startsWith(site))).toEqual(
      expect.arrayContaining(["/terms", "/purchase-terms", "/refunds", "/dashboard/payouts", "/privacy", "/dashboard"].map((p) => site + p)),
    );
    expect(e.html).toContain("You’re getting this email because your organiser profile was approved.");
  });
});

describe("names", () => {
  it("falls back to '{Hi|Hey} there,' for a missing, null or blank name", () => {
    for (const [name, build] of Object.entries(all)) {
      for (const first of [undefined, null, "", "   "]) {
        const e = build(first);
        expect(e.html).toContain(`${GREETING[name]} there,`);
        expect(e.text).toContain(`${GREETING[name]} there,`);
      }
    }
  });

  it("escapes a hostile name in the HTML and keeps it out of the subject", () => {
    for (const [name, build] of Object.entries(all)) {
      const e = build(hostile);
      expect(e.html).not.toContain("<img src=x");
      expect(e.html).toContain(`${GREETING[name]} &#60;img src=x onerror=alert(1)&#62; &#38; &#34;Sam&#34;,`);
      expect(e.subject).not.toContain("Sam");
    }
  });
});

describe("links and plain text", () => {
  it.each(Object.entries(all))("%s: every link is absolute https, on the site, and a real page; the text has them all", (_name, build) => {
    const e = build("Sam");
    const links = hrefs(e.html).filter((h) => !h.startsWith("mailto:"));
    expect(links.length).toBeGreaterThan(1);
    for (const href of links) {
      expect(href.startsWith("https://")).toBe(true);
      expect(href.startsWith(site)).toBe(true);
      expect(routeExists(href), href).toBe(true);
      expect(e.text).toContain(href);
    }
    expect(hrefs(e.html)).toContain("mailto:support@sheltuh.com.au");
    expect(e.text).toContain("support@sheltuh.com.au");
    expect(e.text).toContain("Sheltüh · Melbourne");
    expect(e.text).toContain(`${site}/privacy`);
    expect(e.text).toMatch(/You’re (receiving this|getting this email) because/);
  });

  it("the help line follows the tone: the member welcome's is the customer one, the organiser emails' the organiser one", () => {
    for (const [name, build] of Object.entries(all)) {
      const e = build("Sam");
      const [line, other] = name === "member" ? ["Need a hand?", "Need help?"] : ["Need help?", "Need a hand?"];
      expect(e.html, name).toContain(`${line} <a href="mailto:support@sheltuh.com.au"`);
      expect(e.text, name).toContain(`${line} support@sheltuh.com.au`);
      expect(`${e.html}${e.text}`, name).not.toContain(other);
    }
  });

  it("the buttons go to /events and /dashboard", () => {
    expect(hrefs(all.member().html)).toContain(`${site}/events`);
    expect(hrefs(all.organiserApproved().html)).toContain(`${site}/dashboard`);
    expect(hrefs(all.nextSteps().html)).toContain(`${site}/dashboard`);
  });
});

describe("layout rules (the 1120 layout)", () => {
  it.each(Object.entries(all))("%s: one orange call to action with a black label; orange otherwise only in the hero's eyebrow and second line", (_name, build) => {
    const { html } = build("Sam");
    expect(html.match(/<td align="center" bgcolor="#ff4800"/g)).toHaveLength(1);
    expect(html).toMatch(/<td align="center" bgcolor="#ff4800"[^>]*><a href="[^"]*" style="[^"]*color:#000000/);
    expect(html.match(/(?<![-\w])color:\s*#ff4800/g)).toHaveLength(2);
    // White text only inside the black hero and the black step badges.
    const allowed = new Set<string>(Object.values(KIT));
    for (const m of html.matchAll(/(?:bgcolor="|color:\s*|solid\s+)(#[0-9a-f]{3,8}\b)/gi)) expect(allowed).toContain(m[1].toLowerCase());
  });

  it.each(Object.entries(all))("%s: Instrument Sans on every text element, self-hosted on https, never a third-party font host", (_name, build) => {
    const e = build("Sam");
    expect(SANS).toBe(FONT_STACK);
    for (const tag of ["h1", "h2", "p"]) {
      for (const m of e.html.matchAll(new RegExp(`<${tag} [^>]*style="([^"]*)"`, "g"))) {
        expect(m[1], `${tag}: ${m[1]}`).toMatch(/font-family:'(Instrument Sans|IBM Plex Mono)'/);
      }
    }
    expect(e.html).toContain(`url('${site}${TICKET_EMAIL_FONTS.sans}') format('woff2')`);
    expect(e.html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import|nunito/i);
    expect(e.html).toContain("font-family:Arial,sans-serif!important"); // Outlook pinned
  });

  it.each(Object.entries(all))("%s: one h1 (the hero), 24/32 at 600; body 16/24", (_name, build) => {
    const { html } = build("Sam");
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 style="[^"]*font-size:24px;line-height:32px;font-weight:600/);
    expect(html).toContain("font-size:16px;line-height:24px;font-weight:400");
  });

  it.each(Object.entries(all))("%s: wordmark inline at the top and in the footer, no footer banner, privacy link", (_name, build) => {
    const e = build("Sam");
    expect(e.html.split(`<img src="cid:${WORDMARK_CID}"`)).toHaveLength(3);
    expect(e.inlineImages?.map((i) => i.cid)).toEqual([WORDMARK_CID]);
    expect(e.html).not.toContain("/brand/sheltuh-email-footer.png");
    expect(e.html).toContain(`href="${site}/privacy"`);
    expect(existsSync(path.join(process.cwd(), "public", TICKET_EMAIL_FONTS.sans))).toBe(true);
  });

  it("no @font-face on a non-https site", () => {
    const e = buildMemberWelcomeEmail({ to: "a@example.com", siteUrl: "http://localhost:3000" });
    expect(e.html).not.toContain("@font-face");
  });
});

// The older layout's helpers (lib/server/email-layout.ts): no email renders with them any more (every one is on lib/server/email-kit.ts), but they stay exported and tested until that file is retired.
describe("helpers", () => {
  it("heroImage accepts only https and carries a size and alt", () => {
    expect(() => heroImage({ src: "http://x.test/a.jpg", alt: "A", width: 600, height: 300 })).toThrow();
    const html = heroImage({ src: "https://x.test/a.jpg", alt: 'A "b"', width: 600, height: 300 });
    expect(html).toContain('width="600" height="300" alt="A &#34;b&#34;"');
  });

  it("displayHeading escapes its lines; numberedSteps escapes and numbers in real text", () => {
    expect(displayHeading(["<b>", "x"])).toContain("&#60;b&#62;<br>x");
    const html = numberedSteps([{ title: "<t>", description: "&d", link: { label: "L", href: "https://x.test/?a=1&b=2" } }]);
    expect(html).toContain(">01</td>");
    expect(html).toContain("&#60;t&#62;");
    expect(html).toContain("&#38;d");
    expect(html).toContain('href="https://x.test/?a=1&#38;b=2"');
  });

  it("emailFooter and emailFooterText carry the support line, reason, privacy link and city", () => {
    const html = emailFooter({ reason: "Because <x>.", siteUrl: site });
    expect(html).toContain("Because &#60;x&#62;.");
    expect(html).toContain("Sheltüh &middot; Melbourne");
    const text = emailFooterText({ reason: "Because.", siteUrl: site });
    expect(text).toContain("Because.");
    expect(text).toContain(`${site}/privacy`);
  });
});
