import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

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
    subject: message.subject,
    text: message.text,
    html: message.html,
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
