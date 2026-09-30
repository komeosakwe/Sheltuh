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
 * profile doesn't lift one. The caller only ever sees their own blocks, each
 * with the blocked member's display name as it was when they blocked them.
 */

/** Blocks per member per window: far more than anyone needs, too few to probe handles with. */
export const BLOCK_RATE_LIMIT = { hits: 30, window: "24 hours" } as const;

const NOT_FOUND = "Member not found.";

/** The snapshot taken at block time: never the live profile, which would reveal renames and deletions. */
const BLOCK_COLUMNS = `b.id, b.created_at, b.blocked_display_name as display_name`;

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
 * of a conversation the caller can currently see (or a request they
 * declined), or the member behind an attendeeId on a Who's Going list they
 * may currently view. Anything else is a 404, including a member already
 * blocked either way (they're hidden from the caller already), so blocking
 * can't be used to tell whether two attendeeIds are the same person. Always
 * 201 with the block when it succeeds, including when the caller already had
 * it (e.g. a double submit). Rate-limited (429). Signed in is enough:
 * protecting yourself is never gated on verification. Atomic in
 * private.create_block.
 */
export const createBlock: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const errors: Record<string, string> = {};
  const target = parseTarget(await readJson(req), NOT_FOUND, errors);
  if (Object.keys(errors).length > 0) fail(errors);

  const [row] = await db.query<{
    result: string;
    block_id: string | null;
    block_name: string | null;
    block_created_at: string | Date | null;
  }>(`select * from private.create_block($1, $2, $3, $4, $5::interval)`, [
    caller.userId,
    target.conversationId ?? null,
    target.attendeeId ?? null,
    BLOCK_RATE_LIMIT.hits,
    BLOCK_RATE_LIMIT.window,
  ]);
  switch (row.result) {
    case "blocked":
      return createdPrivate(
        toBlock({ id: row.block_id, display_name: row.block_name, created_at: row.block_created_at }),
      );
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "self":
      throw new HttpError(400, "You can't block yourself.");
    case "rate_limited":
      throw new HttpError(
        429,
        "You've blocked a lot of members today. Try again tomorrow, or email support@sheltuh.com.au if someone is bothering you.",
      );
    default:
      throw new Error(`Unexpected create_block result: ${row.result}`);
  }
};

/** DELETE /api/blocks/[blockId] — unblocks. Idempotent; someone else's block id is a no-op too. */
export const deleteBlock: Handler<{ blockId: string }> = async (req, { blockId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (isUuid(blockId)) {
    await db.query(`delete from public.user_blocks where id = $1 and blocker_id = $2`, [blockId, caller.userId]);
  }
  return noContentPrivate();
};
