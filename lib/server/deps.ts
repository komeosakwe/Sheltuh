import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { VerifyAccessToken } from "./auth";
import { createPostgresDb, type Db } from "./db";
import { createSmtpSender, type SendEmail } from "./email";

/**
 * Everything a handler needs from the outside world. Route files get the
 * real ones from getDeps(); tests pass fakes (tests/server/).
 */
export interface Deps {
  db: Db;
  verifyAccessToken: VerifyAccessToken;
  stripe(): Stripe;
  stripeWebhookSecret(): string;
  /** Public origin of this app, for Stripe redirect URLs, e.g. https://sheltuh.com.au */
  siteUrl(): string;
  /** Transactional email (ticket delivery). Throws if SMTP isn't configured. */
  sendEmail: SendEmail;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let cached: Deps | undefined;

export function getDeps(): Deps {
  if (cached) return cached;

  const db = createPostgresDb(requireEnv("DATABASE_URL"));
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let stripe: Stripe | undefined;
  const smtp = createSmtpSender();

  cached = {
    db,
    // Asks Supabase Auth itself, so a signed-out or deleted user's token
    // stops working immediately and admin promotion applies on the next request.
    async verifyAccessToken(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;
      return {
        userId: data.user.id,
        email: data.user.email,
        isAdmin: data.user.app_metadata?.role === "admin",
      };
    },
    stripe() {
      stripe ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"));
      return stripe;
    },
    stripeWebhookSecret: () => requireEnv("STRIPE_WEBHOOK_SECRET"),
    siteUrl: () => requireEnv("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, ""),
    // Without SMTP, sending fails (and is logged) rather than silently
    // succeeding, so the order's tickets_emailed_at stays null.
    sendEmail:
      smtp ??
      (async () => {
        throw new Error("SMTP isn't configured (SMTP_HOST etc.)");
      }),
  };
  return cached;
}
