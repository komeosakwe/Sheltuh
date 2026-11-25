import { kitFooter, kitHeader, kitHelp, kitIntro, KIT, kitPage, kitStack, kitText, kitType } from "./email-kit";
import { escapeHtml, WORDMARK_CID } from "./email-layout";

/**
 * Supabase Auth's own emails, on the 1120 email kit (lib/server/email-kit.ts)
 * like every other email, as static HTML the owner pastes into Supabase →
 * Authentication → Emails → Templates (docs/supabase-setup.md, "Auth
 * settings"). scripts/render-auth-email-templates.ts writes them to
 * supabase/templates/; tests/server/auth-email-templates.test.ts fails when
 * a committed file is stale.
 *
 * The app uses two: "Confirm signup" (signUp and "Resend code") and "Reset
 * password" (resetPasswordForEmail), each a code the person types
 * (verifyOtp), so each body carries `{{ .Token }}`, never a link. Nothing
 * here sends Magic link, Change email address, Reauthentication or Invite
 * user (lib/auth/AuthContext.tsx; invites are our own email).
 *
 * Supabase renders the subject and body with Go's html/template, which
 * changes what can go in them:
 * - The only actions are `{{ .Token }}` and `{{ .Email }}`, in text only
 *   (never an attribute), so its escaping can't change a URL or a style.
 *   Plain text passes through `escapeHtml`, which leaves them alone.
 * - It drops HTML comments, so the page's Outlook conditional comments are
 *   taken out here: the committed file is what Supabase sends. Outlook for
 *   Windows then shows the fluid column, as any client ignoring the media
 *   query does.
 * - No `cid:` attachment: the wordmark is the kit's own PNG on the site
 *   (public/email/ticket/wordmark.png, the same bytes the other emails
 *   attach), with its alt text when images are blocked.
 *
 * The code, owner's choice "D" (25 Nov 2026): the ticket stub, an orange
 * outline with the label and expiry in mono, a dashed orange divider and the
 * code under it (`codeStub`, the one place to change for another look). It
 * stays one unbroken run (letter spacing, no spaces or spans inside it) so it
 * copies cleanly, `user-select: all` selects it in one tap, and the line
 * "Your Sheltüh code is …" just above, and the subject, put it right after
 * the word "code" for Gmail's and Apple Mail's one-time-code detection.
 */

/** The production origin, which every template links to and loads its fonts and wordmark from. */
export const AUTH_EMAIL_SITE_URL = "https://sheltuh.com.au";

/** Where the rendered templates are committed. */
export const AUTH_EMAIL_TEMPLATE_DIR = "supabase/templates";

/** The kit's orange wordmark on the site (byte-for-byte TICKET_EMAIL_WORDMARK). */
export const AUTH_EMAIL_WORDMARK_PATH = "/email/ticket/wordmark.png";

/** Supabase's placeholders: the code, and the address it was sent to. */
export const TOKEN = "{{ .Token }}";
export const EMAIL = "{{ .Email }}";

/**
 * How long a code works. The app doesn't set or document Supabase's "Email
 * OTP Expiration", so the emails don't promise a time.
 */
const EXPIRY_LABEL = "EXPIRES SOON";
const EXPIRY_LINE = "This code expires soon. If it stops working, ask for a new one.";

/**
 * iOS Mail and Apple Mail would otherwise turn an 8-digit code into a phone
 * number link (blue, and a tap offers to call it).
 */
const HEAD =
  `<meta name="format-detection" content="telephone=no,date=no,address=no">\n` +
  `<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}</style>`;

/**
 * The code block (option D): a 2px orange outline, radius 16; "VERIFICATION
 * CODE" (or `label`) and the expiry in muted mono, a 2px dashed orange
 * divider, then the code, mono 34/40, centred. Letter spacing adds space
 * after the last digit too, so the left padding is 7px more to keep it
 * centred.
 */
function codeStub(label: string): string {
  const small = kitType("mono", 12, 16, 500, KIT.muted, "letter-spacing:0.72px");
  const code = kitType(
    "mono",
    34,
    40,
    600,
    KIT.black,
    "letter-spacing:7px;white-space:nowrap;user-select:all;-webkit-user-select:all;-moz-user-select:all",
  );
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border:2px solid ${KIT.orange};border-radius:16px">` +
    `<tr><td style="padding:16px 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td align="left" valign="middle" style="${small}">${escapeHtml(label)}</td>` +
    `<td align="right" valign="middle" style="padding-left:12px;white-space:nowrap;${small}">${escapeHtml(EXPIRY_LABEL)}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td align="center" style="border-top:2px dashed ${KIT.orange};padding:24px 12px 24px 19px"><span style="${code}">${TOKEN}</span></td></tr>` +
    `</table>`
  );
}

interface AuthEmailCopy {
  /** Supabase's name for the template. */
  supabaseTemplate: string;
  /** The committed file's name under AUTH_EMAIL_TEMPLATE_DIR. */
  file: string;
  /** The subject, with the code first (no apostrophes: html/template would turn them into &#39;). */
  subject: string;
  title: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  /** What to do with the code. */
  instruction: string;
  /** "Your Sheltüh code is", before the code (one-time-code detection). */
  codeLine: string;
  stubLabel: string;
  /** "If this wasn't you, …". */
  notYou: string;
  /** The footer's reason line. */
  reason: string;
}

const COPY: ReadonlyArray<AuthEmailCopy> = [
  {
    supabaseTemplate: "Confirm signup",
    file: "confirm-signup.html",
    subject: `${TOKEN} is your Sheltüh code`,
    title: "Confirm your email",
    preheader: "Enter it on the sign-up page to finish creating your account.",
    eyebrow: "Welcome to Sheltüh",
    heading: "Confirm your email",
    instruction: "Enter this code on the sign-up page to finish creating your account.",
    codeLine: "Your Sheltüh code is",
    stubLabel: "VERIFICATION CODE",
    notYou: "If this wasn’t you, ignore this email. The account can’t be used without the code.",
    reason: `You’re getting this because someone signed up to Sheltüh with ${EMAIL}.`,
  },
  {
    supabaseTemplate: "Reset password",
    file: "reset-password.html",
    subject: `${TOKEN} is your Sheltüh reset code`,
    title: "Reset your password",
    preheader: "Enter it on the reset page with your new password.",
    eyebrow: "Password reset",
    heading: "Reset your password",
    instruction: "Enter this code on the reset page, with your new password.",
    codeLine: "Your Sheltüh reset code is",
    stubLabel: "RESET CODE",
    notYou: "If this wasn’t you, ignore this email. Your password stays the same.",
    reason: `You’re getting this because someone asked to reset the password for ${EMAIL} on Sheltüh.`,
  },
];

export interface AuthEmailTemplate {
  supabaseTemplate: string;
  file: string;
  subject: string;
  html: string;
}

/** Go's html/template drops HTML comments, so take out the kit's Outlook-only ones rather than commit markup Supabase never sends. */
function withoutComments(html: string): string {
  return html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->\n?/g, "");
}

function render(c: AuthEmailCopy, siteUrl: string): string {
  const html = kitPage({
    title: c.title,
    preheader: c.preheader,
    siteUrl,
    tone: "customer",
    head: HEAD,
    body: kitStack([
      kitHeader(),
      kitIntro(c.eyebrow, c.heading),
      kitStack(
        [
          kitText(escapeHtml(c.instruction)),
          kitStack([kitText(`${escapeHtml(c.codeLine)} ${TOKEN}.`, { muted: true }), codeStub(c.stubLabel)], 8),
          kitStack([kitText(escapeHtml(EXPIRY_LINE), { muted: true }), kitText(escapeHtml(c.notYou), { muted: true })], 8),
        ],
        24,
      ),
      kitHelp("customer"),
      kitFooter({ siteUrl, tone: "customer", reason: c.reason }),
    ]),
  });
  const wordmark = `${siteUrl.replace(/\/+$/, "")}${AUTH_EMAIL_WORDMARK_PATH}`;
  return withoutComments(html).replaceAll(`cid:${WORDMARK_CID}`, escapeHtml(wordmark));
}

/** Every Supabase Auth template the app uses, rendered for `siteUrl` (the production origin by default). */
export function buildAuthEmailTemplates(siteUrl: string = AUTH_EMAIL_SITE_URL): AuthEmailTemplate[] {
  return COPY.map((c) => ({ supabaseTemplate: c.supabaseTemplate, file: c.file, subject: c.subject, html: render(c, siteUrl) }));
}

/** supabase/templates/README.md: what to paste where. */
export function authEmailTemplatesReadme(templates: ReadonlyArray<AuthEmailTemplate> = buildAuthEmailTemplates()): string {
  const rows = templates.map((t) => `| ${t.supabaseTemplate} | \`${t.subject}\` | \`${t.file}\` |`).join("\n");
  return `# Supabase Auth email templates

Generated by \`scripts/render-auth-email-templates.ts\` from
\`lib/server/auth-email-templates.ts\` (the 1120 email kit). Don't edit by
hand: change the copy or the kit, run \`node --import tsx
scripts/render-auth-email-templates.ts\`, and commit the output
(\`tests/server/auth-email-templates.test.ts\` fails while a file is stale).

Paste each into Supabase → Authentication → Emails → Templates: the subject
into "Subject", the whole file into "Message body" (Source). Keep
\`{{ .Token }}\` and \`{{ .Email }}\` exactly as they are.

| Supabase template | Subject | File |
| --- | --- | --- |
${rows}

The app sends no other Supabase Auth email (no magic link, email change,
reauthentication or Supabase invite), so the other templates stay as they
are. Steps and caveats: \`docs/supabase-setup.md\`, "Auth settings".
`;
}
