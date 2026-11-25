import { kitButtons, kitFooter, kitHeader, kitHelp, kitIntro, KIT, kitLink, kitPage, kitStack, kitText, kitType } from "./email-kit";
import { escapeHtml, WORDMARK_CID } from "./email-layout";

/**
 * Supabase Auth's own emails, on the 1120 email kit (lib/server/email-kit.ts)
 * like every other email, as static HTML the owner pastes into Supabase →
 * Authentication → Emails → Templates (docs/supabase-setup.md, "Auth
 * settings"). scripts/render-auth-email-templates.ts writes them to
 * supabase/templates/; tests/server/auth-email-templates.test.ts fails when
 * a committed file is stale.
 *
 * The app uses two code emails: "Confirm signup" (signUp and "Resend code")
 * and "Reset password" (resetPasswordForEmail), each a code the person types
 * (verifyOtp), so each body carries `{{ .Token }}`, never a link. And one
 * Security notification, "Password changed", which follows any password
 * update (a reset, or an invitee's first password). Nothing here sends Magic
 * link, Change email address, Reauthentication or Invite user, and with no
 * account email change the "Email address changed" notification can't fire
 * (lib/auth/AuthContext.tsx; invites are our own email).
 *
 * Supabase renders the subject and body with Go's html/template, which
 * changes what can go in them:
 * - The only actions are `{{ .Token }}` (code emails) and `{{ .Email }}`, in text only
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

interface CodeEmailCopy {
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

const CODE_EMAILS: ReadonlyArray<CodeEmailCopy> = [
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
  /** Supabase's name for the template. */
  supabaseTemplate: string;
  /** Where it is under Authentication → Emails → Templates: the main list, or the Security notifications. */
  section: "Templates" | "Security";
  /** "code": carries `{{ .Token }}` in its subject and body. "notice": no code. */
  kind: "code" | "notice";
  file: string;
  subject: string;
  html: string;
}

/** The forgot-password page (app/forgot-password), from the security notice. */
export const FORGOT_PASSWORD_PATH = "/forgot-password";

/** Go's html/template drops HTML comments, so take out the kit's Outlook-only ones rather than commit markup Supabase never sends. */
function withoutComments(html: string): string {
  return html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->\n?/g, "");
}

/** The page around `body`: the kit page, without comments, with the hosted wordmark. */
function page(input: { title: string; preheader: string; siteUrl: string; body: string }): string {
  const html = kitPage({ ...input, tone: "customer", head: HEAD });
  const wordmark = `${input.siteUrl.replace(/\/+$/, "")}${AUTH_EMAIL_WORDMARK_PATH}`;
  return withoutComments(html).replaceAll(`cid:${WORDMARK_CID}`, escapeHtml(wordmark));
}

function renderCode(c: CodeEmailCopy, siteUrl: string): string {
  return page({
    title: c.title,
    preheader: c.preheader,
    siteUrl,
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
}

/**
 * Security → "Password changed" (Supabase's `password_changed_notification`):
 * sent after every password update while that notification is on, so after
 * a reset and also when an invitee sets their first password
 * (setNewPassword). Supabase gives it only SiteURL, Email and Data (no time:
 * the email's own sent time is when it happened), so it uses `{{ .Email }}`
 * alone. A notice: no code, and a button to the forgot-password page.
 */
function renderPasswordChanged(siteUrl: string): string {
  const reset = new URL(FORGOT_PASSWORD_PATH, siteUrl).href;
  return page({
    title: "Your Sheltüh password was changed",
    preheader: "If this wasn’t you, reset your password now.",
    siteUrl,
    body: kitStack([
      kitHeader(),
      kitIntro("Account security", "Your password was changed"),
      kitStack(
        [
          kitText(`The password for your Sheltüh account, ${EMAIL}, was just changed.`),
          kitText(escapeHtml("If you reset it or set it up from an invite, there’s nothing to do.")),
          kitText(
            `<strong style="font-weight:600">If this wasn’t you,</strong> ${kitLink(reset, "reset your password now")}.`,
          ),
          kitButtons([{ label: "Reset your password", href: reset, kind: "primary" }]),
        ],
        24,
      ),
      kitHelp("customer"),
      kitFooter({ siteUrl, tone: "customer", reason: "You’re getting this security notice because the password on your Sheltüh account changed." }),
    ]),
  });
}

/** Every Supabase Auth template the app uses, rendered for `siteUrl` (the production origin by default). */
export function buildAuthEmailTemplates(siteUrl: string = AUTH_EMAIL_SITE_URL): AuthEmailTemplate[] {
  return [
    ...CODE_EMAILS.map((c): AuthEmailTemplate => ({
      supabaseTemplate: c.supabaseTemplate,
      section: "Templates",
      kind: "code",
      file: c.file,
      subject: c.subject,
      html: renderCode(c, siteUrl),
    })),
    {
      supabaseTemplate: "Password changed",
      section: "Security",
      kind: "notice",
      file: "password-changed.html",
      subject: "Your Sheltüh password was changed",
      html: renderPasswordChanged(siteUrl),
    },
  ];
}

/** supabase/templates/README.md: what to paste where. */
export function authEmailTemplatesReadme(templates: ReadonlyArray<AuthEmailTemplate> = buildAuthEmailTemplates()): string {
  const rows = templates
    .map((t) => `| ${t.section === "Security" ? `Security → ${t.supabaseTemplate}` : t.supabaseTemplate} | \`${t.subject}\` | \`${t.file}\` |`)
    .join("\n");
  return `# Supabase Auth email templates

Generated by \`scripts/render-auth-email-templates.ts\` from
\`lib/server/auth-email-templates.ts\` (the 1120 email kit). Don't edit by
hand: change the copy or the kit, run \`node --import tsx
scripts/render-auth-email-templates.ts\`, and commit the output
(\`tests/server/auth-email-templates.test.ts\` fails while a file is stale).

Paste each into Supabase → Authentication → Emails → Templates (the
"Security" ones under its Security notifications): the subject into
"Subject", the whole file into "Message body" (Source). Keep \`{{ .Token }}\`
and \`{{ .Email }}\` exactly as they are.

| Supabase template | Subject | File |
| --- | --- | --- |
${rows}

The app sends no other Supabase Auth email (no magic link, email change,
reauthentication or Supabase invite), so the other templates stay as they
are. "Email address changed" (Security) can't fire: there's no account
email change. Steps and caveats: \`docs/supabase-setup.md\`, "Auth settings".
`;
}
