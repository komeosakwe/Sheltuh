/**
 * Screenshots the committed Supabase Auth templates (supabase/templates/,
 * rendered by scripts/render-auth-email-templates.ts) with Playwright's
 * Chromium. Sends nothing and touches no service.
 *
 *   node --import tsx scripts/preview-auth-email-templates.ts [--out=dir]
 *
 * Each template is filled in as Supabase's Go html/template fills it (a
 * sample 8-digit code; the address with `+` escaped as `&#43;`), its fonts
 * and wordmark swapped for the local files (nothing is fetched), then shot
 * full page at 680, 600 and 375px: light, dark (the reader's system set to
 * dark: the page declares itself light only, as every kit email does) and
 * forced dark (Chromium's auto dark mode, roughly what a client that ignores
 * that declaration does). Plus an inbox row per template showing its subject.
 * A browser isn't an email client: check real clients before trusting it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUTH_EMAIL_SITE_URL, AUTH_EMAIL_TEMPLATE_DIR, buildAuthEmailTemplates, EMAIL, TOKEN } from "../lib/server/auth-email-templates";
import { escapeHtml } from "../lib/server/email-layout";

const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
const outDir = outArg ? path.resolve(outArg.slice("--out=".length)) : path.join(tmpdir(), "sheltuh-auth-email-previews");
const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";
const SAMPLE = { token: "72863684", email: "maya+test@example.com" };

/** What html/template writes for a string in text context: &, <, >, ", ', + and NUL escaped. */
function goHtmlEscape(value: string): string {
  return value.replace(/[&<>"'+\0]/g, (c) => (c === "\0" ? "�" : `&#${c.charCodeAt(0)};`));
}

/** The committed file, filled in, with the site's assets from public/. */
function local(file: string): string {
  const html = readFileSync(path.join(process.cwd(), AUTH_EMAIL_TEMPLATE_DIR, file), "utf8")
    .replaceAll(TOKEN, goHtmlEscape(SAMPLE.token))
    .replaceAll(EMAIL, goHtmlEscape(SAMPLE.email));
  return html.replaceAll(`${AUTH_EMAIL_SITE_URL}/`, `file://${path.join(process.cwd(), "public")}/`);
}

function inbox(subject: string, preheader: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f6f8fc;font-family:Arial,Helvetica,sans-serif;color:#202124}
.row{display:flex;gap:12px;align-items:baseline;background:#fff;margin:16px;padding:14px 16px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.15);font-size:14px}
.from{font-weight:700;width:120px;flex:none}.subject{font-weight:700}.pre{color:#5f6368}.time{margin-left:auto;font-weight:700;flex:none}
</style></head><body><div class="row"><span class="from">Sheltüh</span><span><span class="subject">${escapeHtml(subject)}</span> <span class="pre">– ${escapeHtml(preheader)}</span></span><span class="time">8:20 am</span></div></body></html>`;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const executable = existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {};
  const browser = await chromium.launch(executable);
  const forcedDark = await chromium.launch({ ...executable, args: ["--enable-features=WebContentsForceDark"] });
  const written: string[] = [];
  const overflows: string[] = [];
  const shoot = async (b: typeof browser, name: string, html: string, width: number, colorScheme: "light" | "dark", fullPage = true) => {
    const file = path.join(outDir, `${name}.html`);
    writeFileSync(file, html);
    const page = await b.newPage({ viewport: { width, height: fullPage ? 800 : 80 }, deviceScaleFactor: 2, colorScheme });
    await page.goto(`file://${file}`);
    await page.evaluate(() => document.fonts.ready);
    if ((await page.evaluate(() => document.documentElement.scrollWidth)) > width) overflows.push(`${name} at ${width}px`);
    const png = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: png, fullPage });
    await page.close();
    written.push(png);
  };
  try {
    for (const t of buildAuthEmailTemplates()) {
      const name = t.file.replace(/\.html$/, "");
      const html = local(t.file);
      for (const width of [680, 600, 375]) {
        await shoot(browser, `${name}-${width}-light`, html, width, "light");
        await shoot(browser, `${name}-${width}-dark`, html, width, "dark");
        await shoot(forcedDark, `${name}-${width}-forced-dark`, html, width, "dark");
      }
      const preheader = html.match(/<div style="display:none[^>]*>([^&<]*)/)?.[1] ?? "";
      const subject = t.subject.replaceAll(TOKEN, SAMPLE.token);
      await shoot(browser, `${name}-subject`, inbox(subject, preheader), 760, "light", false);
    }
  } finally {
    await browser.close();
    await forcedDark.close();
  }
  console.log(overflows.length ? `Horizontal overflow:\n  ${overflows.join("\n  ")}` : "No horizontal overflow at any width.");
  console.log(written.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
