import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeBookingFee } from "@/lib/fees";
import { WHOS_GOING_SUMMARY } from "@/lib/whos-going-copy";
import type { EmailMessage } from "@/lib/server/email";
import {
  button,
  displayHeading,
  EMAIL_COLOURS,
  emailFontFace,
  emailFooter,
  emailFooterText,
  heroImage,
  numberedSteps,
  SANS,
  SIGNAL,
  WORDMARK_CID,
} from "@/lib/server/email-layout";
import { buildMemberWelcomeEmail, buildOrganiserNextStepsEmail, buildOrganiserWelcomeEmail } from "@/lib/server/onboarding-email";

const site = "https://sheltuh.test";
const FONT_STACK = "'Nunito Sans','Nunito','Avenir Next','Segoe UI',Arial,sans-serif";
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

describe("subjects, headings and copy", () => {
  it("member welcome", () => {
    const e = all.member("Sam");
    expect(e.subject).toBe("Welcome to Sheltüh — find your people");
    expect(e.html).toContain("Find your room.<br>Find your people.");
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

  it("organiser welcome variants share the subject, heading and preheader", () => {
    const approved = all.organiserApproved("Sam");
    const pending = all.organiserPending("Sam");
    for (const e of [approved, pending]) {
      expect(e.subject).toBe("Bring your people together with Sheltüh");
      expect(e.html).toContain("You make the space.<br>Bring your people together.");
      expect(e.html).toContain("Make space for your ideas—and the people who connect with them.");
      expect(e.html).toContain("Open organiser dashboard");
    }
    expect(approved.html).toContain("Start setting up your organiser profile and shaping your first event.");
    expect(approved.html).toContain("Introduce yourself");
    expect(approved.html).toContain("You’re receiving this because you set up an organiser profile.");
    expect(approved.html).not.toContain("Thanks for applying");
    expect(pending.html).toContain("Thanks for applying. A person checks every organiser before they can publish.");
    expect(pending.html).toContain("We check your application");
    expect(pending.html).toContain("free events don’t need them.");
    expect(pending.html).toContain("You’re receiving this because you applied to be an organiser on Sheltüh.");
    expect(pending.html).not.toContain("Introduce yourself");
  });

  it("organiser next steps: five sections, the fee from describeBookingFee, links to real pages", () => {
    const e = all.nextSteps("Sam");
    expect(e.subject).toBe("Before your first event on Sheltüh");
    expect(e.html).toContain("A few things to know.");
    expect(e.html).toContain(`(${describeBookingFee()})`);
    expect(e.text).toContain(`(${describeBookingFee()})`);
    for (const n of ["01", "02", "03", "04", "05"]) expect(e.html).toContain(`>${n}</td>`);
    expect(hrefs(e.html).filter((h) => h.startsWith(site))).toEqual(
      expect.arrayContaining(["/terms", "/purchase-terms", "/refunds", "/dashboard/payouts", "/privacy", "/dashboard"].map((p) => site + p)),
    );
    expect(e.html).toContain("You’re receiving this because your organiser profile was approved.");
  });
});

describe("names", () => {
  it("falls back to 'Hey there,' for a missing, null or blank name", () => {
    for (const build of Object.values(all)) {
      for (const name of [undefined, null, "", "   "]) {
        const e = build(name);
        expect(e.html).toContain("Hey there,");
        expect(e.text).toContain("Hey there,");
      }
    }
  });

  it("escapes a hostile name in the HTML and keeps it out of the subject", () => {
    for (const build of Object.values(all)) {
      const e = build(hostile);
      expect(e.html).not.toContain("<img src=x");
      expect(e.html).toContain("Hey &#60;img src=x onerror=alert(1)&#62; &#38; &#34;Sam&#34;,");
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
    expect(e.text).toContain("You’re receiving this because");
  });

  it("the buttons go to /events and /dashboard", () => {
    expect(hrefs(all.member().html)).toContain(`${site}/events`);
    expect(hrefs(all.organiserApproved().html)).toContain(`${site}/dashboard`);
    expect(hrefs(all.nextSteps().html)).toContain(`${site}/dashboard`);
  });
});

describe("layout rules", () => {
  it.each(Object.entries(all))("%s: one orange button with black text, nothing else orange", (_name, build) => {
    const { html } = build("Sam");
    const cell = button("x", "https://x").match(/<td [^>]*>/)![0];
    expect(html.split(cell)).toHaveLength(2);
    expect(html.replace(cell, "")).not.toContain(SIGNAL);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff|white)/i);
    const allowed = new Set<string>(Object.values(EMAIL_COLOURS));
    for (const m of html.matchAll(/(?:bgcolor="|color:\s*|solid\s+)(#[0-9a-f]{3,8}\b)/gi)) expect(allowed).toContain(m[1].toLowerCase());
  });

  it.each(Object.entries(all))("%s: the font stack on every text element, no web font loading", (_name, build) => {
    const e = build("Sam");
    expect(SANS).toBe(FONT_STACK);
    for (const tag of ["h1", "h2", "p", "a"]) {
      for (const m of e.html.matchAll(new RegExp(`<${tag} [^>]*style="([^"]*)"`, "g"))) {
        if (tag === "a" && !m[1].includes("display:block")) continue; // inline text links inherit the paragraph's face
        expect(m[1], `${tag}: ${m[1]}`).toContain(`font-family:${FONT_STACK}`);
      }
    }
    expect(e.html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import/i);
    expect(e.html).toContain("'Segoe UI', Arial, sans-serif !important"); // Outlook pinned
  });

  it.each(Object.entries(all))("%s: heading 36/44 at 600, section headings 22/28 at 500, body 16/24 at 400", (_name, build) => {
    const { html } = build("Sam");
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="h1"[^>]*font-size:36px;line-height:44px;font-weight:600/);
    expect(html).toContain(".h1 { font-size: 30px !important; line-height: 36px !important; }");
    for (const m of html.matchAll(/<h2 [^>]*style="([^"]*)"/g)) expect(m[1]).toContain("font-size:22px;line-height:28px;font-weight:500");
    expect(html).toContain("font-size:16px;line-height:24px;font-weight:400");
    expect(html).toContain("font-weight:500;color:#000000;text-decoration:none"); // button label
    expect(html).not.toMatch(/text-transform|letter-spacing:\s*[1-9.]/i);
  });

  it.each(Object.entries(all))("%s: wordmark inline, one orange footer banner, privacy link, https-only font", (_name, build) => {
    const e = build("Sam");
    expect(e.html.split(`<img src="cid:${WORDMARK_CID}"`)).toHaveLength(2);
    expect(e.inlineImages?.[0]?.cid).toBe(WORDMARK_CID);
    expect(e.html.split(`${site}/brand/sheltuh-email-footer.png`)).toHaveLength(2);
    expect(e.html).toContain(`href="${site}/privacy"`);
    expect(e.html).toContain(`url('${site}/fonts/nunito/Nunito-VariableFont_wght.ttf')`);
    expect(existsSync(path.join(process.cwd(), "public/fonts/nunito/OFL.txt"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public/fonts/nunito/Nunito-VariableFont_wght.ttf"))).toBe(true);
  });

  it("no @font-face on a non-https site", () => {
    expect(emailFontFace("http://localhost:3000")).toBe("");
    expect(emailFontFace(undefined)).toBe("");
    const e = buildMemberWelcomeEmail({ to: "a@example.com", siteUrl: "http://localhost:3000" });
    expect(e.html).not.toContain("@font-face");
  });
});

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
