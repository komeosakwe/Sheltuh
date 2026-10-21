import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http";

/**
 * Authentication for Vercel Cron routes (docs/architecture.md, "Payment
 * flow"). Shared by every cron handler so they all check the secret the
 * same way.
 */

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in
 * constant time (as fixed-length digests, so the length doesn't leak either).
 * Without CRON_SECRET set, nothing gets in.
 */
export function requireCronSecret(req: Request, secret: string | undefined): void {
  if (!secret) {
    console.error("CRON_SECRET isn't set: refusing a cron request.");
    throw new HttpError(401, "Unauthorized.");
  }
  const match = req.headers.get("authorization")?.match(/^Bearer (.+)$/);
  if (!match || !timingSafeEqual(sha256(match[1]), sha256(secret))) {
    throw new HttpError(401, "Unauthorized.");
  }
}
