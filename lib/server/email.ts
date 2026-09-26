import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

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
  });

  return async (message) => {
    await transport.sendMail({ from: EMAIL_FROM, ...message });
  };
}
