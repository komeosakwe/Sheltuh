import { PG_UNDEFINED_COLUMN, PG_UNDEFINED_FUNCTION, PG_UNDEFINED_TABLE, pgErrorCode, type Db } from "./db";

/**
 * Deploy-order tolerance for delayed payouts (supabase/migrations/20261119000000_delayed_payouts.sql). The
 * migration goes first (docs/DEPLOYMENT.md), but a new app that starts before it is applied must not break
 * paid checkouts and refunds, which is what reading public.orders.payout_method or calling
 * private.flag_transfer_after_refund would do on the old schema (42703 / 42883), nor the admin summary
 * (private.order_transfers, 42P01). Those few places catch the
 * error, ask this module whether the schema really lacks the migration, and fall back to what the app did
 * before it: every order is a 'destination' order and nothing is transferred. The same approach as
 * private.queue_member_welcomes in lib/server/handlers/email-outbox.ts.
 */

/** Logged once per process while the database lacks the migration. */
let warned = false;

/**
 * True when `err` is an undefined column / function / table error AND the catalogue confirms the migration isn't
 * applied (an undefined_function can also come from inside some other function, and must still be thrown).
 * When the catalogue can't be read either, the original error is the one to throw: false.
 */
export async function payoutsSchemaMissing(db: Db, err: unknown): Promise<boolean> {
  const code = pgErrorCode(err);
  if (code !== PG_UNDEFINED_COLUMN && code !== PG_UNDEFINED_FUNCTION && code !== PG_UNDEFINED_TABLE) return false;
  try {
    const [row] = await db.query<{ missing: boolean }>(
      `select (to_regprocedure('private.flag_transfer_after_refund(text,text)') is null
               or to_regclass('private.order_transfers') is null
               or not exists (select 1 from pg_attribute
                               where attrelid = 'public.orders'::regclass and attname = 'payout_method' and not attisdropped)) as missing`,
    );
    if (row?.missing !== true) return false;
  } catch {
    return false;
  }
  if (!warned) {
    warned = true;
    console.warn(
      "Delayed payouts: migration 20261119000000_delayed_payouts.sql isn't applied; every order is treated as a destination order (paid out with its payment) until it is.",
    );
  }
  return true;
}

/** Test hook: forget that the warning was logged. */
export function resetPayoutSchemaWarning(): void {
  warned = false;
}
