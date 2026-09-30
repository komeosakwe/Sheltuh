import { requireCaller } from "../auth";
import { createdPrivate, HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { parseTarget } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { toBlock } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";

/**
 * Blocks (docs/architecture.md, "Messages"). Silent: the blocked member isn't
 * told. While either blocks the other, their conversation is hidden from both
 * and neither can message the other, and each is left out of the other's
 * Who's Going list. Keyed on the accounts, so deleting and recreating a
 * profile doesn't lift one. The caller only ever sees their own blocks.
 */

const NOT_FOUND = "Member not found.";

const BLOCK_COLUMNS = `b.id, b.created_at, (select p.display_name from public.profiles p where p.user_id = b.blocked_id) as display_name`;

/** GET /api/blocks?cursor — the caller's blocks, newest first. */
export const listBlocks: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query(
    `select ${BLOCK_COLUMNS} from public.user_blocks b where b.blocker_id = $1
      order by b.created_at desc, b.id limit $2 offset $3`,
    [caller.userId, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toBlock), offset, limit));
};

/**
 * POST /api/blocks {conversationId} | {attendeeId} — blocks the other member
 * of one of the caller's conversations (whatever its state), or the member
 * behind a Who's Going attendeeId. Idempotent: 201 when created, 200 when
 * already blocked. Signed in is enough: protecting yourself is never gated.
 */
export const createBlock: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const errors: Record<string, string> = {};
  const target = parseTarget(await readJson(req), NOT_FOUND, errors);
  if (Object.keys(errors).length > 0) fail(errors);

  const [found] = target.conversationId
    ? await db.query<{ user_id: string }>(
        `select case when c.user_low = $2 then c.user_high else c.user_low end as user_id
           from public.conversations c where c.id = $1 and (c.user_low = $2 or c.user_high = $2)`,
        [target.conversationId, caller.userId],
      )
    : await db.query<{ user_id: string }>(`select a.user_id from public.event_attendees a where a.id = $1`, [
        target.attendeeId,
      ]);
  if (!found) throw new HttpError(404, NOT_FOUND);
  if (found.user_id === caller.userId) throw new HttpError(400, "You can't block yourself.");

  const [inserted] = await db.query(
    `insert into public.user_blocks as b (blocker_id, blocked_id) values ($1, $2)
     on conflict (blocker_id, blocked_id) do nothing
     returning ${BLOCK_COLUMNS}`,
    [caller.userId, found.user_id],
  );
  if (inserted) return createdPrivate(toBlock(inserted));
  const [existing] = await db.query(
    `select ${BLOCK_COLUMNS} from public.user_blocks b where b.blocker_id = $1 and b.blocked_id = $2`,
    [caller.userId, found.user_id],
  );
  // Unblocked again in between: nothing to return, and nothing blocked.
  if (!existing) throw new HttpError(409, "That block changed while you were saving it. Try again.");
  return okPrivate(toBlock(existing));
};

/** DELETE /api/blocks/[blockId] — unblocks. Idempotent; someone else's block id is a no-op too. */
export const deleteBlock: Handler<{ blockId: string }> = async (req, { blockId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (isUuid(blockId)) {
    await db.query(`delete from public.user_blocks where id = $1 and blocker_id = $2`, [blockId, caller.userId]);
  }
  return noContentPrivate();
};
