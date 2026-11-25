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
  FORGOT_PASSWORD_PATH,
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
const codeTemplates = templates.filter((t) => t.kind === "code");
const noticeTemplates = templates.filter((t) => t.kind === "notice");

describe("supabase/templates", () => {
  it("matches a fresh render (run scripts/render-auth-email-templates.ts and commit the output)", () => {
    for (const t of templates) expect(committed(t.file), t.file).toBe(t.html);
    expect(committed("README.md")).toBe(authEmailTemplatesReadme(templates));
  });

  it("holds only the rendered templates and the README", () => {
    expect(readdirSync(dir).sort()).toEqual([...templates.map((t) => t.file), "README.md"].sort());
  });

  it("covers the two code templates the app's flows use, and the password-changed security notice", () => {
    expect(templates.map((t) => [t.section, t.supabaseTemplate, t.kind, t.file])).toEqual([
      ["Templates", "Confirm signup", "code", "confirm-signup.html"],
      ["Templates", "Reset password", "code", "reset-password.html"],
      ["Security", "Password changed", "notice", "password-changed.html"],
    ]);
    const auth = readFileSync(path.join(process.cwd(), "lib/auth/AuthContext.tsx"), "utf8");
    // Codes, typed by the person: signup (with resend) and recovery.
    expect(auth).toContain(`type: "signup"`);
    expect(auth).toContain(`type: "recovery"`);
    expect(auth).toContain("resetPasswordForEmail");
    // No flow that would send another Supabase template.
    for (const call of ["signInWithOtp", "reauthenticate", "inviteUserByEmail", "updateUser({ email"]) expect(auth).not.toContain(call);
    // A password update (the reset, an invitee's first password) is what sends "Password changed".
    expect(auth).toContain("updateUser({ password");
  });

  it("lists every template with its subject in the README", () => {
    const readme = authEmailTemplatesReadme(templates);
    for (const t of templates) expect(readme).toContain(`\`${t.subject}\` | \`${t.file}\``);
    expect(readme).toContain("| Security → Password changed |");
  });
});

describe.each(codeTemplates)("$supabaseTemplate (code)", (t) => {
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

  it("uses Supabase's Token and Email placeholders only", () => {
    expect(new Set(t.html.match(/\{\{[^}]*\}\}/g))).toEqual(new Set([TOKEN, EMAIL]));
    expect(count(t.html, EMAIL)).toBe(1);
  });

  it("says why it came, what to do if it wasn’t them, and that the code expires", () => {
    expect(t.html).toContain("You’re getting this because someone ");
    expect(t.html).toContain("If this wasn’t you, ignore this email.");
    expect(t.html).toContain("This code expires soon.");
    // Apple Mail would link an 8-digit code as a phone number.
    expect(t.html).toContain('<meta name="format-detection" content="telephone=no,date=no,address=no">');
  });
});

describe.each(noticeTemplates)("$supabaseTemplate (notice)", (t) => {
  it("has the subject the owner set, and no code anywhere (Supabase gives this template none)", () => {
    expect(t.subject).toBe("Your Sheltüh password was changed");
    expect(t.subject).not.toContain("{{");
    expect(t.html).not.toContain(TOKEN);
    expect(t.html).not.toContain("EXPIRES SOON");
    expect(t.html).not.toContain("user-select:all");
  });

  it("uses only {{ .Email }}, which Supabase's password_changed_notification provides (with SiteURL and Data)", () => {
    expect(new Set(t.html.match(/\{\{[^}]*\}\}/g))).toEqual(new Set([EMAIL]));
    expect(t.html).toContain(`The password for your Sheltüh account, ${EMAIL}, was just changed.`);
  });

  it("tells them what to do if it wasn’t them: reset now, on the app's forgot-password page", () => {
    expect(existsSync(path.join(process.cwd(), "app", FORGOT_PASSWORD_PATH, "page.tsx"))).toBe(true);
    const reset = `${AUTH_EMAIL_SITE_URL}${FORGOT_PASSWORD_PATH}`;
    expect(reset).toBe("https://sheltuh.com.au/forgot-password");
    expect(t.html).toContain("If this wasn’t you,");
    expect(t.html).toMatch(new RegExp(`<a href="${reset}"[^>]*>reset your password now</a>`));
    expect(t.html).toMatch(new RegExp(`<a[^>]* href="${reset}"[^>]*>Reset your password`));
    expect(t.html).toContain("If you reset it or set it up from an invite, there’s nothing to do.");
    expect(t.html).toContain("You’re getting this security notice because the password on your Sheltüh account changed.");
  });
});

describe.each(templates)("$supabaseTemplate", (t) => {
  it("puts placeholders in text only, never in a tag, with no other template delimiters", () => {
    const actions = t.html.match(/\{\{[^}]*\}\}/g) ?? [];
    expect(actions.length).toBeGreaterThan(0);
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

  it("has the kit's help line, footer links, language and light-only scheme", () => {
    expect(t.subject).not.toMatch(/['"<>&+]/);
    expect(t.html).toContain("You’re getting this ");
    expect(t.html).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(t.html).toContain(`${AUTH_EMAIL_SITE_URL}/privacy`);
    expect(t.html).toContain('<html lang="en-AU"');
    expect(t.html).toContain('<meta name="color-scheme" content="light">');
  });
});
