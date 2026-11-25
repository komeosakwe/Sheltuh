import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/contact";
import {
  AUTH_EMAIL_SITE_URL,
  AUTH_EMAIL_TEMPLATE_DIR,
  AUTH_EMAIL_WORDMARK_PATH,
  authEmailTemplatesReadme,
  buildAuthEmailTemplates,
  EMAIL,
  TOKEN,
} from "@/lib/server/auth-email-templates";
import { KIT } from "@/lib/server/email-kit";
import { TICKET_EMAIL_WORDMARK } from "@/lib/server/email-ticket-wordmark";

// Supabase Auth's email templates (lib/server/auth-email-templates.ts), committed
// under supabase/templates/ for the owner to paste into Supabase
// (docs/supabase-setup.md, "Auth settings"). Supabase renders subject and
// body with Go's html/template.

const dir = path.join(process.cwd(), AUTH_EMAIL_TEMPLATE_DIR);
const templates = buildAuthEmailTemplates();
const committed = (file: string) => readFileSync(path.join(dir, file), "utf8");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("supabase/templates", () => {
  it("matches a fresh render (run scripts/render-auth-email-templates.ts and commit the output)", () => {
    for (const t of templates) expect(committed(t.file), t.file).toBe(t.html);
    expect(committed("README.md")).toBe(authEmailTemplatesReadme(templates));
  });

  it("holds only the rendered templates and the README", () => {
    expect(readdirSync(dir).sort()).toEqual([...templates.map((t) => t.file), "README.md"].sort());
  });

  it("covers the two templates the app's code flows use", () => {
    expect(templates.map((t) => [t.supabaseTemplate, t.file])).toEqual([
      ["Confirm signup", "confirm-signup.html"],
      ["Reset password", "reset-password.html"],
    ]);
    const auth = readFileSync(path.join(process.cwd(), "lib/auth/AuthContext.tsx"), "utf8");
    // Codes, typed by the person: signup (with resend) and recovery.
    expect(auth).toContain(`type: "signup"`);
    expect(auth).toContain(`type: "recovery"`);
    expect(auth).toContain("resetPasswordForEmail");
    // No flow that would send another Supabase template.
    for (const call of ["signInWithOtp", "reauthenticate", "inviteUserByEmail", "updateUser({ email"]) expect(auth).not.toContain(call);
  });
});

describe.each(templates)("$supabaseTemplate", (t) => {
  it("puts the code first in the subject, next to the word code, with nothing html/template would escape", () => {
    expect(t.subject.startsWith(`${TOKEN} is your Sheltüh `)).toBe(true);
    expect(t.subject).toMatch(/ code$/);
    expect(count(t.subject, TOKEN)).toBe(1);
    expect(t.subject).not.toMatch(/['"<>&+]/);
  });

  it("carries the code twice: after the words “code is”, and in the stub as one selectable run", () => {
    expect(count(t.html, TOKEN)).toBe(2);
    expect(t.html).toMatch(/Your Sheltüh (reset )?code is \{\{ \.Token \}\}\.<\/p>/);
    // The stub: the token alone in its span (no spaces or spans inside), letter-spaced, select-all.
    const stub = t.html.match(/<span style="([^"]*)">\{\{ \.Token \}\}<\/span>/);
    expect(stub).not.toBeNull();
    expect(stub![1]).toContain("user-select:all");
    expect(stub![1]).toContain("-webkit-user-select:all");
    expect(stub![1]).toContain("letter-spacing:7px");
    expect(t.html).toContain(`border:2px solid ${KIT.orange}`);
    expect(t.html).toContain(`border-top:2px dashed ${KIT.orange}`);
    expect(t.html).toContain("EXPIRES SOON");
  });

  it("uses only Supabase's Token and Email placeholders, in text, never in a tag", () => {
    const actions = t.html.match(/\{\{[^}]*\}\}/g) ?? [];
    expect(new Set(actions)).toEqual(new Set([TOKEN, EMAIL]));
    expect(count(t.html, EMAIL)).toBe(1);
    // No other Go template delimiters anywhere (a stray one is a parse error, or worse, an action).
    expect(count(t.html, "{{")).toBe(actions.length);
    expect(count(t.html, "}}")).toBe(actions.length);
    expect(t.html).not.toMatch(/<[^>]*\{\{/);
  });

  it("has nothing Supabase can't send: no comments (html/template drops them) and no cid: attachments", () => {
    expect(t.html).not.toContain("<!--");
    expect(t.html).not.toContain("cid:");
    expect(t.html.length).toBeLessThan(102_000);
  });

  it("loads only the site's own assets, which exist in public/", () => {
    // Every URL but the <html> element's XHTML namespace (a name, never fetched).
    const urls = (t.html.match(/https?:\/\/[^\s"')<]+/g) ?? []).filter((url) => url !== "http://www.w3.org/1999/xhtml");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(`${AUTH_EMAIL_SITE_URL}/`), url).toBe(true);
    }
    const assets = [...t.html.matchAll(/(?:src="|url\(')(https:\/\/[^"']+)/g)].map((m) => new URL(m[1]).pathname);
    expect(assets).toContain(AUTH_EMAIL_WORDMARK_PATH);
    for (const asset of assets) expect(existsSync(path.join(process.cwd(), "public", asset)), asset).toBe(true);
    // The hosted wordmark is the same image the other emails attach inline.
    expect(readFileSync(path.join(process.cwd(), "public", AUTH_EMAIL_WORDMARK_PATH)).toString("base64")).toBe(TICKET_EMAIL_WORDMARK.pngBase64);
  });

  it("says why it came, what to do if it wasn’t them, that the code expires, and where help is", () => {
    expect(t.html).toContain("You’re getting this because someone ");
    expect(t.html).toContain(`${EMAIL}`);
    expect(t.html).toContain("If this wasn’t you, ignore this email.");
    expect(t.html).toContain("This code expires soon.");
    expect(t.html).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(t.html).toContain(`${AUTH_EMAIL_SITE_URL}/privacy`);
    expect(t.html).toContain('<html lang="en-AU"');
    expect(t.html).toContain('<meta name="color-scheme" content="light">');
    // Apple Mail would link an 8-digit code as a phone number.
    expect(t.html).toContain('<meta name="format-detection" content="telephone=no,date=no,address=no">');
  });
});
