import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import Stripe from "stripe";
import type { VerifyAccessToken } from "./auth";
import { createClipStorage, type ClipStorage } from "./clip-storage";
import { createPostgresDb, type Db } from "./db";
import { createSmtpSender, type SendEmail } from "./email";
import { redactForLog } from "./email-address";
import { matchingPublishableKey } from "./stripe-keys";

/**
 * Everything a handler needs from the outside world. Route files get the
 * real ones from getDeps(); tests pass fakes (tests/server/).
 */
export interface Deps {
  db: Db;
  verifyAccessToken: VerifyAccessToken;
  stripe(): Stripe;
  stripeWebhookSecret(): string;
  /**
   * The Stripe publishable key the payment page mounts Stripe's form with,
   * or undefined when it's unset or its mode (test or live) isn't the secret
   * key's (logged, without either key). Card checkouts are refused (503)
   * before anything is written when it's undefined.
   */
  stripePublishableKey(): string | undefined;
  /** Public origin of this app, for Stripe redirect URLs, e.g. https://sheltuh.com.au */
  siteUrl(): string;
  /** Transactional email (ticket delivery). Throws if SMTP isn't configured. */
  sendEmail: SendEmail;
  /**
   * Runs `task` after the response has been sent (Next's `after()`), so the
   * buyer isn't kept waiting on SMTP. Best-effort: the task must be safe to
   * lose, because the cron route (/api/cron/email-outbox) picks up anything
   * it didn't finish. Must be called while handling a request.
   */
  defer(task: () => Promise<void>): void;
  /** The shared secret Vercel Cron sends as `Authorization: Bearer …`; undefined when unset (cron routes then refuse everything). */
  cronSecret(): string | undefined;
  /**
   * Event clips' Supabase Storage (lib/server/clip-storage.ts), created on
   * first use; undefined when SUPABASE_CLIP_STORAGE_KEY (or the Supabase URL)
   * is unset, and the clip routes then answer 503.
   */
  clipStorage(): ClipStorage | undefined;
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
  // null: looked, and it isn't configured.
  let clipStorage: ClipStorage | null | undefined;
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
        emailVerified: Boolean(data.user.email_confirmed_at),
        isAdmin: data.user.app_metadata?.role === "admin",
      };
    },
    stripe() {
      stripe ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"));
      return stripe;
    },
    stripeWebhookSecret: () => requireEnv("STRIPE_WEBHOOK_SECRET"),
    // A literal process.env.NEXT_PUBLIC_… reference: Next inlines it at build time, so the server checks the
    // same value the browser's bundle was built with.
    stripePublishableKey: () =>
      matchingPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, process.env.STRIPE_SECRET_KEY),
    siteUrl: () => requireEnv("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, ""),
    // Without SMTP, sending fails (and is logged) rather than silently
    // succeeding, so the order's tickets_emailed_at stays null.
    sendEmail:
      smtp ??
      (async () => {
        throw new Error("SMTP isn't configured (SMTP_HOST etc.)");
      }),
    defer(task) {
      after(async () => {
        try {
          await task();
        } catch (err) {
          console.error("Deferred task failed:", redactForLog(err instanceof Error ? err.message : "unknown error"));
        }
      });
    },
    cronSecret: () => process.env.CRON_SECRET || undefined,
    clipStorage() {
      if (clipStorage === undefined) clipStorage = createClipStorage() ?? null;
      return clipStorage ?? undefined;
    },
  };
  return cached;
}
