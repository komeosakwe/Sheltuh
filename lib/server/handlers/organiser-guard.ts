import type { Caller } from "../auth";
import type { Db } from "../db";
import { HttpError } from "../http";
import { ORGANISER_SELECT, toOrganiser } from "../records";
import type { OrganiserRecord } from "../types";

export async function findOrganiserByOwner(db: Db, userId: string): Promise<OrganiserRecord | undefined> {
  const [row] = await db.query(`${ORGANISER_SELECT} where o.owner_user_id = $1`, [userId]);
  return row ? toOrganiser(row) : undefined;
}

export async function findOrganiserById(db: Db, organiserId: string): Promise<OrganiserRecord | undefined> {
  const [row] = await db.query(`${ORGANISER_SELECT} where o.id = $1`, [organiserId]);
  return row ? toOrganiser(row) : undefined;
}

/** The caller's own organiser record, which must be approved. */
export async function requireApprovedOrganiser(db: Db, caller: Caller): Promise<OrganiserRecord> {
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record || record.status !== "approved") {
    throw new HttpError(403, "Your organiser application must be approved before you can submit events.");
  }
  return record;
}
