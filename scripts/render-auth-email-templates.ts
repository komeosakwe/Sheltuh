/**
 * Writes Supabase Auth's email templates (lib/server/auth-email-templates.ts,
 * the 1120 email kit) to supabase/templates/, with a README listing each
 * template's subject and file, for pasting into Supabase → Authentication →
 * Emails → Templates (docs/supabase-setup.md, "Auth settings"). Sends nothing
 * and touches no service.
 *
 *   node --import tsx scripts/render-auth-email-templates.ts
 *
 * Run it after changing the kit or the templates' copy, and commit the
 * output: tests/server/auth-email-templates.test.ts fails while a committed
 * file is stale.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AUTH_EMAIL_TEMPLATE_DIR, authEmailTemplatesReadme, buildAuthEmailTemplates } from "../lib/server/auth-email-templates";

const dir = path.join(process.cwd(), AUTH_EMAIL_TEMPLATE_DIR);
mkdirSync(dir, { recursive: true });
const templates = buildAuthEmailTemplates();
for (const t of templates) {
  writeFileSync(path.join(dir, t.file), t.html);
  console.log(`${path.join(AUTH_EMAIL_TEMPLATE_DIR, t.file)}  (${t.supabaseTemplate}: "${t.subject}")`);
}
writeFileSync(path.join(dir, "README.md"), authEmailTemplatesReadme(templates));
console.log(path.join(AUTH_EMAIL_TEMPLATE_DIR, "README.md"));
