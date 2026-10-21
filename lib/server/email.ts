import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

/**
 * An image embedded in the message and shown by the HTML as
 * `<img src="cid:{cid}">` (e.g. a ticket's QR code). Sent as an inline
 * attachment in a multipart/related part, so it shows even when a client
 * blocks remote images.
 */
export interface InlineImage {
  /** Unique within the message; the HTML refers to it as `cid:{cid}`. */
  cid: string;
  contentType: "image/png";
  content: Buffer;
  /** Shown if a client lists the image as an attachment. */
  filename?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages?: InlineImage[];
  /**
   * Extra message headers, e.g. `List-Unsubscribe` on waitlist emails.
   * Values are fixed text or URLs the server built, never user input.
   */
  headers?: Record<string, string>;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

/**
 * A subject line, or a header-bound piece of one, from organiser-supplied
 * text (an event title, an organiser's name): control, invisible and
 * text-direction characters (bidi overrides and isolates, zero-width
 * characters, line and paragraph separators) become one space, so the text
 * can't reorder or hide what the inbox shows, or bend the header. Every email
 * builder runs its subject through this, and mailOptions does again.
 */
export function subjectLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Nodemailer's options for one message. The recipient goes in as an address
 * object, which nodemailer uses as a single address: a string would be parsed
 * as an address list, so a stored value like "a@x.com, b@y.com" or
 * "name <b@y.com>" could reach someone other than the buyer. (The API only
 * stores plain addresses: lib/server/email-address.ts.)
 */
export function mailOptions(from: string, message: EmailMessage): Mail.Options {
  return {
    from,
    to: { name: "", address: message.to },
    // Already clean from every builder; again here so no subject can reach the header uncleaned.
    subject: subjectLine(message.subject),
    text: message.text,
    html: message.html,
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.inlineImages?.length
      ? {
          attachments: message.inlineImages.map((image) => ({
            cid: image.cid,
            contentType: image.contentType,
            content: image.content,
            contentDisposition: "inline" as const,
            ...(image.filename ? { filename: image.filename } : {}),
          })),
        }
      : {}),
  };
}

/**
 * SMTP sender from env, or null when SMTP isn't configured. Any SMTP server
 * works; the Google Workspace account already on sheltuh.com.au is enough
 * for launch volumes (see docs/supabase-setup.md).
 */
export function createSmtpSender(env: NodeJS.ProcessEnv = process.env): SendEmail | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) return null;

  const port = Number(SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Well inside the email outbox's 2-minute lease (lib/server/email-outbox.ts),
    // so a hung server fails the attempt rather than outliving it and sending twice.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return async (message) => {
    await transport.sendMail(mailOptions(EMAIL_FROM, message));
  };
}
