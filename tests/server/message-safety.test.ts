import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BLOCK_RATE_LIMIT, createBlock, deleteBlock, listBlocks } from "@/lib/server/handlers/blocks";
import { listGoingAttendees } from "@/lib/server/handlers/going";
import {
  declineConversation,
  getMessages,
  getUnreadCount,
  listConversations,
  sendMessage,
  startConversation,
} from "@/lib/server/handlers/messages";
import { deleteMyProfile } from "@/lib/server/handlers/profiles";
import { adminListReports, adminResolveReport, createReport, REPORT_RATE_LIMIT } from "@/lib/server/handlers/reports";
import type { EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { goingMember, member, optIn, suspend, type GoingMember } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string; email: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin);
});

type Token = { token: string };

const going = (displayName?: string, e: EventRecord = event) => goingMember(api, e, { displayName });
const start = (from: Token, attendeeId: string, body = "Hi! Keen for the show?") =>
  api.call(startConversation, { token: from.token, body: { attendeeId, body } });
const send = (from: Token, conversationId: string, body = "Hello") =>
  api.call(sendMessage, { token: from.token, params: { conversationId }, body: { body } });
const list = (m: Token) => api.call(listConversations, { token: m.token });
const thread = (m: Token, conversationId: string) =>
  api.call(getMessages, { token: m.token, params: { conversationId } });
const unread = async (m: Token) => (await api.call(getUnreadCount, { token: m.token })).body.count as number;
const block = (m: Token, body: unknown) => api.call(createBlock, { token: m.token, body });
const unblock = (m: Token, blockId: string) =>
  api.call(deleteBlock, { token: m.token, params: { blockId }, method: "DELETE" });
const blocks = (m: Token) => api.call(listBlocks, { token: m.token });
const decline = (m: Token, conversationId: string) =>
  api.call(declineConversation, { token: m.token, params: { conversationId }, method: "POST" });
const report = (m: Token, body: unknown) => api.call(createReport, { token: m.token, body });
const attendeeNames = async (m: Token) =>
  (await api.call(listGoingAttendees, { token: m.token, params: { eventId: event.eventId } })).body.items.map(
    (a: { displayName: string }) => a.displayName,
  );

async function conversation(a: GoingMember, b: GoingMember, reply = true) {
  const res = await start(a, b.attendeeId);
  expect(res.status).toBe(201);
  const id = res.body.conversationId as string;
  if (reply) expect((await send(b, id, "Hey, yes!")).status).toBe(201);
  return id;
}

async function messageIds(conversationId: string) {
  return (
    await api.db.query<{ id: string }>(
      `select m.id::text as id from public.messages m where m.conversation_id = $1 order by m.id`,
      [
      conversationId,
    ])
  ).map((r) => r.id);
}

async function blockRows() {
  return api.db.query<{ blocker_id: string; blocked_id: string }>(`select blocker_id, blocked_id from public.user_blocks`);
}

async function reportRows() {
  return api.db.query<Record<string, unknown>>(
    `select reporter_id, reported_user_id, conversation_id, message_id::text as message_id, event_id, reason, details,
            reported_display_name, message_body, context, status
       from private.user_reports order by created_at`,
  );
}

describe("blocking", () => {
  it("by conversation: silent, hides it from both, stops both sending, and unblocking restores it", async () => {
    const a = await going("Ada");
    const b = await going("Grace");
    const id = await conversation(a, b);
    await send(a, id, "unread by B");

    const res = await block(b, { conversationId: id });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual(["blockId", "createdAt", "displayName"]);
    expect(res.body.displayName).toBe("Ada");
    expect(await blockRows()).toEqual([{ blocker_id: b.userId, blocked_id: a.userId }]);

    for (const m of [a, b]) {
      expect((await list(m)).body.items).toEqual([]);
      expect((await thread(m, id)).status).toBe(404);
      expect((await send(m, id)).status).toBe(404);
      expect(await unread(m)).toBe(0);
    }
    // Neither can start a new one; it looks exactly like an unknown member.
    const unknown = await start(a, crypto.randomUUID());
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const again = await start(from, to.attendeeId);
      expect(again.status).toBe(404);
      expect(again.body).toEqual(unknown.body);
    }

    // The conversation is now hidden from both, so blocking by it again is the
    // same 404 as an unknown conversation, for either member: it doesn't say
    // who blocked whom. Nothing changes.
    const unknownConversation = await block(b, { conversationId: crypto.randomUUID() });
    for (const m of [a, b]) {
      const repeat = await block(m, { conversationId: id });
      expect(repeat.status).toBe(404);
      expect(repeat.body).toEqual(unknownConversation.body);
    }
    expect(await blockRows()).toHaveLength(1);

    const mine = await blocks(b);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect(mine.body.items).toEqual([res.body]);
    expect((await blocks(a)).body.items).toEqual([]);
    const raw = JSON.stringify([res.body, mine.body]);
    for (const m of [a, b]) {
      expect(raw).not.toContain(m.userId);
      expect(raw).not.toContain(m.email);
    }

    const removed = await unblock(b, res.body.blockId);
    expect(removed.status).toBe(204);
    expect(await blockRows()).toEqual([]);
    expect((await list(b)).body.items).toHaveLength(1);
    expect(await unread(b)).toBe(1);
    expect((await send(a, id)).status).toBe(201);
  });

  it("by attendeeId, before any conversation: each disappears from the other's Who's Going list", async () => {
    const a = await going("Ada");
    const b = await going("Grace");
    const c = await going("Hedy");

    expect((await block(a, { attendeeId: b.attendeeId })).status).toBe(201);
    expect(await attendeeNames(a)).toEqual(["Ada", "Hedy"]);
    expect(await attendeeNames(b)).toEqual(["Grace", "Hedy"]);
    expect(await attendeeNames(c)).toEqual(["Ada", "Grace", "Hedy"]);
    expect((await start(b, a.attendeeId)).status).toBe(404);
    expect((await start(a, b.attendeeId)).status).toBe(404);
    expect((await start(c, a.attendeeId)).status).toBe(201);
  });

  it("works on a request the blocker declined; repeating it returns the same block (201, idempotent)", async () => {
    const a = await going("Ada");
    const b = await going();
    const id = await conversation(a, b, false);
    expect((await decline(b, id)).status).toBe(204);
    const first = await block(b, { conversationId: id });
    expect(first.status).toBe(201);
    await api.db.query(`update public.profiles set display_name = 'Renamed' where user_id = $1`, [a.userId]);
    const repeat = await block(b, { conversationId: id });
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual(first.body);
    expect(repeat.body.displayName).toBe("Ada");
    expect(await blockRows()).toHaveLength(1);
    // Even if A had blocked B first: the same 201, so B learns nothing from it.
    await unblock(b, first.body.blockId);
    await api.db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [a.userId, b.userId]);
    expect((await block(b, { conversationId: id })).status).toBe(201);
    // The sender still sees their declined request (declining is silent), but
    // with a block either way it's hidden from them: 404.
    expect((await block(a, { conversationId: id })).status).toBe(404);
  });

  it("only what the caller can currently see: hidden conversations and unlistable attendees are 404", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    const ab = await conversation(a, b);
    const unknown = await block(a, { attendeeId: crypto.randomUUID() });
    const expectHidden = async (m: Token, body: unknown) => {
      const res = await block(m, body);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(unknown.body);
    };

    // The other member of a conversation is suspended: it's hidden, so 404.
    await suspend(api, b);
    await expectHidden(a, { conversationId: ab });
    // A suspended attendee isn't on anyone's list.
    await expectHidden(c, { attendeeId: b.attendeeId });
    // A suspended caller can't view lists.
    await expectHidden(b, { attendeeId: c.attendeeId });
    await api.db.query(`delete from private.social_suspensions`);

    // No profile: can't view lists.
    const noProfile = await member(api, { profile: false });
    await expectHidden(noProfile, { attendeeId: c.attendeeId });

    // Who's Going switched off, then the event over: nothing is listed.
    await api.db.query(`update public.events set whos_going_enabled = false`);
    await expectHidden(a, { attendeeId: c.attendeeId });
    await api.db.query(`update public.events set whos_going_enabled = true, starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute'`);
    await expectHidden(a, { attendeeId: c.attendeeId });
    expect(await blockRows()).toEqual([]);
    // The conversation still works (accepted conversations outlive the event).
    expect((await block(a, { conversationId: ab })).status).toBe(201);
  });

  it("can't tell whether two attendeeIds are the same person (no 'already blocked' answer)", async () => {
    // A blocks B on the first event, having kept B's attendeeId from a second
    // event's list. Blocking by that id is the same 404 as an unknown id, not
    // a distinct "already blocked" answer; a different member's id is a plain 201.
    const second = await publishedEvent(api, organiser, admin, { title: "Second" });
    const a = await going("Ada");
    const b = await going("Grace");
    await optIn(api, a, second);
    const bOnSecond = await optIn(api, b, second);
    const c = await going("Hedy", second);
    expect((await block(a, { attendeeId: b.attendeeId })).status).toBe(201);

    const unknown = await block(a, { attendeeId: crypto.randomUUID() });
    const sameb = await block(a, { attendeeId: bOnSecond });
    expect(sameb.status).toBe(404);
    expect(sameb.body).toEqual(unknown.body);
    // The same id again: also 404 (B isn't on A's list any more).
    expect((await block(a, { attendeeId: b.attendeeId })).body).toEqual(unknown.body);
    // Nor whether someone blocked you: B blocked by A tries A's id.
    expect((await block(b, { attendeeId: a.attendeeId })).body).toEqual(unknown.body);

    const fresh = await block(a, { attendeeId: c.attendeeId });
    expect(fresh.status).toBe(201);
    expect(Object.keys(fresh.body).sort()).toEqual(["blockId", "createdAt", "displayName"]);
    expect(await blockRows()).toHaveLength(2);
  });

  it("the blocks list shows the name as it was when blocked, whatever the member does after", async () => {
    const a = await going();
    const b = await going("Grace");
    const res = await block(a, { attendeeId: b.attendeeId });
    expect(res.body.displayName).toBe("Grace");
    const shown = async () => (await blocks(a)).body.items.map((i: { displayName?: string }) => i.displayName);

    await api.db.query(`update public.profiles set display_name = 'Renamed' where user_id = $1`, [b.userId]);
    expect(await shown()).toEqual(["Grace"]);
    await api.call(deleteMyProfile, { token: b.token, method: "DELETE" });
    expect(await shown()).toEqual(["Grace"]);
    await api.db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'Someone else', now())`,
      [b.userId],
    );
    expect(await shown()).toEqual(["Grace"]);
    expect((await blocks(a)).body.items[0]).toEqual(res.body);
  });

  it(`is rate-limited to ${BLOCK_RATE_LIMIT.hits} per ${BLOCK_RATE_LIMIT.window}; refused attempts don't count`, async () => {
    const a = await going();
    for (let i = 0; i < 3; i++) expect((await block(a, { attendeeId: crypto.randomUUID() })).status).toBe(404);
    expect((await block(a, { attendeeId: a.attendeeId })).status).toBe(400);
    const others = [];
    for (let i = 0; i <= BLOCK_RATE_LIMIT.hits; i++) others.push(await going());
    for (const o of others.slice(0, BLOCK_RATE_LIMIT.hits)) {
      expect((await block(a, { attendeeId: o.attendeeId })).status).toBe(201);
    }
    const limited = await block(a, { attendeeId: others[BLOCK_RATE_LIMIT.hits].attendeeId });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
    expect(await blockRows()).toHaveLength(BLOCK_RATE_LIMIT.hits);
  });

  it("validates its target: exactly one id, not yourself, and only your own conversations", async () => {
    const a = await going();
    const b = await going();
    const stranger = await going();
    const id = await conversation(a, b);

    expect((await api.call(createBlock, { body: { conversationId: id } })).status).toBe(401);
    for (const body of [{}, { conversationId: id, attendeeId: b.attendeeId }, { conversationId: 5 }]) {
      expect((await block(a, body)).status).toBe(400);
    }
    expect((await block(a, { attendeeId: a.attendeeId })).status).toBe(400);
    expect((await block(stranger, { conversationId: id })).status).toBe(404);
    expect((await block(a, { conversationId: crypto.randomUUID() })).status).toBe(404);
    expect((await block(a, { attendeeId: "nope" })).status).toBe(404);
    expect(await blockRows()).toEqual([]);
  });

  it("can't remove someone else's block (still 204, nothing changes)", async () => {
    const a = await going();
    const b = await going();
    const res = await block(a, { attendeeId: b.attendeeId });
    expect((await unblock(b, res.body.blockId)).status).toBe(204);
    expect((await unblock(b, "not-a-uuid")).status).toBe(204);
    expect(await blockRows()).toHaveLength(1);
    expect((await api.call(deleteBlock, { params: { blockId: res.body.blockId }, method: "DELETE" })).status).toBe(401);
  });

  it("outlives the blocked member's profile (keyed on the account), and goes with either account", async () => {
    const a = await going();
    const b = await going();
    await block(a, { attendeeId: b.attendeeId });
    await api.call(deleteMyProfile, { token: b.token, method: "DELETE" });
    expect(await blockRows()).toHaveLength(1);
    // The blocker keeps the name they blocked (a snapshot, not the live profile).
    expect((await blocks(a)).body.items[0].displayName).toBe(b.displayName);

    // They come back with a new profile and opt in again: still blocked.
    await api.db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'New me', now())`,
      [b.userId],
    );
    const again = await optIn(api, b, event);
    expect((await start(a, again)).status).toBe(404);
    expect((await start(b, a.attendeeId)).status).toBe(404);

    await api.db.query(`delete from auth.users where id = $1`, [b.userId]);
    expect(await blockRows()).toEqual([]);
  });
});

describe("reporting", () => {
  it("a message: keeps a copy of it and the conversation up to it, and the reporter's name isn't needed", async () => {
    const a = await going("Ada");
    const b = await going("Grace");
    const id = await conversation(a, b);
    await send(a, id, "Something nasty");
    await send(b, id, "Please stop");
    await send(a, id, "After the report point");
    const [, , nasty] = await messageIds(id);

    const res = await report(b, { conversationId: id, messageId: nasty, reason: "harassment", details: " Kept going " });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "reportId"]);

    const [row] = await reportRows();
    expect(row).toMatchObject({
      reporter_id: b.userId,
      reported_user_id: a.userId,
      conversation_id: id,
      message_id: nasty,
      event_id: event.eventId,
      reason: "harassment",
      details: "Kept going",
      reported_display_name: "Ada",
      message_body: "Something nasty",
      status: "open",
    });
    expect((row.context as { from: string; body: string }[]).map((m) => [m.from, m.body])).toEqual([
      ["reported", "Hi! Keen for the show?"],
      ["reporter", "Hey, yes!"],
      ["reported", "Something nasty"],
    ]);
  });

  it("the whole conversation (no messageId), even after blocking it; keeps the last 20 messages", async () => {
    const a = await going();
    const b = await going();
    const id = await conversation(a, b);
    await api.db.query(
      `insert into public.messages (conversation_id, sender_id, body)
       select $1, $2, 'spam ' || g from generate_series(1, 30) g`,
      [id, a.userId],
    );
    await block(b, { conversationId: id });
    expect((await report(b, { conversationId: id, reason: "spam" })).status).toBe(201);
    const [row] = await reportRows();
    const context = row.context as { body: string }[];
    expect(context).toHaveLength(20);
    expect(context[0].body).toBe("spam 11");
    expect(context.at(-1)?.body).toBe("spam 30");
    expect(row.message_body).toBeNull();
  });

  it("a member on a Who's Going list, by attendeeId (e.g. an offensive name)", async () => {
    const a = await going("Rude name");
    const b = await going();
    expect((await report(b, { attendeeId: a.attendeeId, reason: "inappropriate" })).status).toBe(201);
    expect(await reportRows()).toEqual([
      expect.objectContaining({
        reporter_id: b.userId,
        reported_user_id: a.userId,
        conversation_id: null,
        event_id: event.eventId,
        reported_display_name: "Rude name",
        context: [],
      }),
    ]);
    expect((await report(b, { attendeeId: b.attendeeId, reason: "other" })).status).toBe(400);
  });

  it("only the other member's messages, in your own conversations (404 otherwise)", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    const ab = await conversation(a, b);
    const ac = await conversation(a, c);
    const [fromA, fromB] = await messageIds(ab);
    const [inOther] = await messageIds(ac);

    expect((await report(b, { conversationId: ab, messageId: fromB, reason: "spam" })).status).toBe(404);
    expect((await report(b, { conversationId: ab, messageId: inOther, reason: "spam" })).status).toBe(404);
    expect((await report(c, { conversationId: ab, messageId: fromA, reason: "spam" })).status).toBe(404);
    expect((await report(b, { conversationId: crypto.randomUUID(), reason: "spam" })).status).toBe(404);
    expect((await report(b, { attendeeId: crypto.randomUUID(), reason: "spam" })).status).toBe(404);
    expect(await reportRows()).toEqual([]);
  });

  it("validates the body (400) and needs a signed-in member (401)", async () => {
    const a = await going();
    const b = await going();
    const id = await conversation(a, b);
    const [first] = await messageIds(id);
    expect((await api.call(createReport, { body: { conversationId: id, reason: "spam" } })).status).toBe(401);
    for (const body of [
      { conversationId: id },
      { conversationId: id, reason: "boring" },
      { reason: "spam" },
      { conversationId: id, attendeeId: a.attendeeId, reason: "spam" },
      { attendeeId: a.attendeeId, messageId: first, reason: "spam" },
      { conversationId: id, messageId: "abc", reason: "spam" },
      { conversationId: id, reason: "spam", details: "x".repeat(1001) },
    ]) {
      const res = await report(b, body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors ?? {})).not.toHaveLength(0);
    }
    expect(await reportRows()).toEqual([]);
  });

  it("refuses huge details fast (400), before any cleaning", async () => {
    const a = await going();
    const b = await going();
    const started = performance.now();
    const res = await report(b, { attendeeId: a.attendeeId, reason: "spam", details: `${" ".repeat(200_000)}x` });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.details).toBe("Must be 1000 characters or fewer.");
    expect(await reportRows()).toEqual([]);
  });

  it(`is rate-limited to ${REPORT_RATE_LIMIT.hits} per ${REPORT_RATE_LIMIT.window}`, async () => {
    const a = await going();
    const b = await going();
    for (let i = 0; i < REPORT_RATE_LIMIT.hits; i++) {
      expect((await report(b, { attendeeId: a.attendeeId, reason: "spam" })).status).toBe(201);
    }
    expect((await report(b, { attendeeId: a.attendeeId, reason: "spam" })).status).toBe(429);
    expect(await reportRows()).toHaveLength(REPORT_RATE_LIMIT.hits);
  });

  it("the evidence survives deleting the messages, the profile and the account", async () => {
    const a = await going("Ada");
    const b = await going();
    const id = await conversation(a, b);
    await send(a, id, "Evidence");
    const ids = await messageIds(id);
    await report(b, { conversationId: id, messageId: ids.at(-1), reason: "harassment" });

    await api.call(deleteMyProfile, { token: a.token, method: "DELETE" });
    expect(await api.db.query(`select 1 from public.messages`)).toEqual([]);
    await api.db.query(`delete from auth.users where id = $1`, [a.userId]);
    await api.db.query(`delete from auth.users where id = $1`, [b.userId]);

    const [row] = await reportRows();
    expect(row).toMatchObject({
      reporter_id: null,
      reported_user_id: null,
      conversation_id: null,
      message_id: null,
      reported_display_name: "Ada",
      message_body: "Evidence",
    });
    expect((row.context as unknown[]).length).toBe(3);

    const [queued] = (await api.call(adminListReports, { token: admin.token })).body.items;
    expect(queued).toMatchObject({ reportedAccountExists: false, messageBody: "Evidence", reportedDisplayName: "Ada" });
  });
});

// Two sessions at once, which only a real server has (PGlite is one
// connection). Run with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("reports racing a deletion (real Postgres only)", () => {
  const fileReport = (sql: postgres.Sql, reporter: GoingMember, target: { conversationId?: string; attendeeId?: string; messageId?: string }) =>
    sql.unsafe(`select result from private.file_report($1, $2, $3, $4::bigint, 'harassment', null, 20, '1 day')`, [
      reporter.userId,
      target.conversationId ?? null,
      target.attendeeId ?? null,
      target.messageId ?? null,
    ]);

  /** Runs `deletion` in its own transaction, starts the report while it's uncommitted, waits until the report is blocked, commits. */
  async function reportDuringDeletion(deletion: string, params: unknown[], start: (sql: postgres.Sql) => ReturnType<typeof fileReport>) {
    const deleter = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const reporter = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await deleter.unsafe("begin");
      await deleter.unsafe(deletion, params as postgres.ParameterOrJSON<never>[]);
      const [{ pid }] = await reporter.unsafe("select pg_backend_pid() as pid");
      const pending = start(reporter).execute();
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") break;
        if (i > 200) throw new Error("the report never waited for the deletion");
        await new Promise((r) => setTimeout(r, 25));
      }
      await deleter.unsafe("commit");
      return (await pending)[0].result as string;
    } finally {
      await deleter.end();
      await reporter.end();
    }
  }

  it("the reported member deleting their profile mid-report: a clean not_found (404), not a foreign-key 500", async () => {
    const a = await going();
    const b = await going();
    const id = await conversation(a, b);
    const [fromA] = await messageIds(id);
    const result = await reportDuringDeletion(`delete from public.profiles where user_id = $1`, [a.userId], (sql) =>
      fileReport(sql, b, { conversationId: id, messageId: fromA }),
    );
    expect(result).toBe("not_found");
    expect(await reportRows()).toEqual([]);
    expect(await api.db.query(`select 1 from private.rate_limits where user_id = $1 and bucket = 'user_reports'`, [b.userId])).toEqual([]);
  });

  it("the reported member deleting their account mid-report (by attendeeId): not_found, no hit kept", async () => {
    const a = await going();
    const b = await going();
    const result = await reportDuringDeletion(`delete from auth.users where id = $1`, [a.userId], (sql) =>
      fileReport(sql, b, { attendeeId: a.attendeeId }),
    );
    expect(result).toBe("not_found");
    expect(await reportRows()).toEqual([]);
    expect(await api.db.query(`select 1 from private.rate_limits where user_id = $1 and bucket = 'user_reports'`, [b.userId])).toEqual([]);
  });

  it("a report in progress holds off the deletion; the evidence is kept once it lands", async () => {
    const a = await going();
    const b = await going();
    const id = await conversation(a, b);
    const [fromA] = await messageIds(id);
    const reporter = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const deleter = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await reporter.unsafe("begin");
      expect((await fileReport(reporter, b, { conversationId: id, messageId: fromA }))[0].result).toBe("filed");
      const deleting = deleter.unsafe(`delete from public.profiles where user_id = $1`, [a.userId]).execute();
      const early = await Promise.race([deleting.then(() => "deleted"), new Promise((r) => setTimeout(() => r("waiting"), 300))]);
      expect(early).toBe("waiting");
      await reporter.unsafe("commit");
      await deleting;
    } finally {
      await reporter.end();
      await deleter.end();
    }
    const [row] = await reportRows();
    expect(row).toMatchObject({ conversation_id: null, message_id: null, message_body: "Hi! Keen for the show?" });
  });
});

describe("admin report queue", () => {
  const listReports = (token: string, query?: Record<string, string>) =>
    api.call(adminListReports, { token, query });
  const resolve = (token: string, reportId: string, body: unknown) =>
    api.call(adminResolveReport, { token, params: { reportId }, body });

  async function filed(reporter: GoingMember, reported: GoingMember, reason = "harassment") {
    const res = await report(reporter, { attendeeId: reported.attendeeId, reason });
    expect(res.status).toBe(201);
    return res.body.reportId as string;
  }

  it("is admin only (401/403)", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    expect((await api.call(adminListReports, {})).status).toBe(401);
    expect((await listReports(a.token)).status).toBe(403);
    expect((await resolve(a.token, id, { action: "suspend" })).status).toBe(403);
    expect(await api.db.query(`select 1 from private.social_suspensions`)).toEqual([]);
  });

  it("lists open reports oldest first, with copies and names but never a user id or email", async () => {
    const a = await going("Ada");
    const b = await going("Grace");
    const id = await conversation(a, b);
    const [first] = await messageIds(id);
    await report(b, { conversationId: id, messageId: first, reason: "harassment", details: "Creepy" });
    await filed(a, b, "spam");

    const res = await listReports(admin.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items).toHaveLength(2);
    const [oldest, newest] = res.body.items;
    expect(oldest).toMatchObject({
      status: "open",
      reason: "harassment",
      details: "Creepy",
      reportedDisplayName: "Ada",
      reportedAccountExists: true,
      reportedSuspended: false,
      eventTitle: event.title,
      messageBody: "Hi! Keen for the show?",
      context: [{ from: "reported", body: "Hi! Keen for the show?" }],
    });
    expect(newest).toMatchObject({ reason: "spam", reportedDisplayName: "Grace", context: [] });
    const raw = JSON.stringify(res.body);
    for (const m of [a, b, admin]) {
      expect(raw).not.toContain(m.userId);
      expect(raw).not.toContain(m.email);
    }
    expect((await listReports(admin.token, { status: "closed" })).status).toBe(400);
    expect((await listReports(admin.token, { status: "dismissed" })).body.items).toEqual([]);
  });

  it("dismiss: closes it once; a second resolve is a 409", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    const res = await resolve(admin.token, id, { action: "dismiss", note: "Fine" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reportId: id, status: "dismissed", resolutionNote: "Fine" });
    expect(res.body.resolvedAt).toBeDefined();
    expect((await resolve(admin.token, id, { action: "suspend" })).status).toBe(409);
    expect(await api.db.query(`select 1 from private.social_suspensions`)).toEqual([]);
    expect((await listReports(admin.token)).body.items).toEqual([]);
    expect((await listReports(admin.token, { status: "dismissed" })).body.items).toHaveLength(1);
  });

  it("suspend: suspends the reported member in the same step; their conversations disappear", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    const bc = await conversation(b, c);
    const id = await filed(a, b);

    const res = await resolve(admin.token, id, { action: "suspend" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "actioned", reportedSuspended: true });
    const [suspension] = await api.db.query<{ user_id: string; reason: string }>(
      `select user_id, reason from private.social_suspensions`,
    );
    expect(suspension.user_id).toBe(b.userId);
    expect(suspension.reason).toContain(id);
    expect((await send(b, bc)).status).toBe(403);
    expect((await list(c)).body.items).toEqual([]);
  });

  it("two admins resolving at once: exactly one succeeds", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    const other = await signUpAdmin(api);
    const results = await Promise.all([
      resolve(admin.token, id, { action: "dismiss" }),
      resolve(other.token, id, { action: "suspend" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [{ status }] = await api.db.query<{ status: string }>(`select status from private.user_reports`);
    const suspended = (await api.db.query(`select 1 from private.social_suspensions`)).length === 1;
    expect(suspended).toBe(status === "actioned");
  });

  it("validates the action (400) and the id (404)", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    expect((await resolve(admin.token, id, { action: "ban" })).status).toBe(400);
    expect((await resolve(admin.token, id, {})).status).toBe(400);
    expect((await resolve(admin.token, crypto.randomUUID(), { action: "dismiss" })).status).toBe(404);
    expect((await resolve(admin.token, "nope", { action: "dismiss" })).status).toBe(404);
    expect((await listReports(admin.token)).body.items).toHaveLength(1);
  });

  it("refuses a huge note fast (400), before any cleaning", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    const started = performance.now();
    const res = await resolve(admin.token, id, { action: "dismiss", note: `${" ".repeat(200_000)}x` });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.note).toBe("Must be 1000 characters or fewer.");
  });

  it("private.resolve_report refuses an unknown action", async () => {
    const a = await going();
    const b = await going();
    const id = await filed(b, a);
    await expect(api.db.query(`select private.resolve_report($1, $2, 'ban', null)`, [id, admin.userId])).rejects.toThrow();
  });
});

describe("retention of reports", () => {
  it("private.purge_social_data deletes resolved reports 2 years after resolution, and never open ones", async () => {
    const a = await going();
    const b = await going();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await report(b, { attendeeId: a.attendeeId, reason: "spam" })).body.reportId);
    const [oldClosed, recentClosed, oldOpen] = ids;
    await api.call(adminResolveReport, { token: admin.token, params: { reportId: oldClosed }, body: { action: "dismiss" } });
    await api.call(adminResolveReport, {
      token: admin.token,
      params: { reportId: recentClosed },
      body: { action: "dismiss" },
    });
    await api.db.query(
      `update private.user_reports set resolved_at = now() - interval '2 years' - interval '1 day',
                                       created_at = now() - interval '3 years' where id = $1`,
      [oldClosed],
    );
    await api.db.query(
      `update private.user_reports set resolved_at = now() - interval '2 years' + interval '1 day' where id = $1`,
      [recentClosed],
    );
    await api.db.query(`update private.user_reports set created_at = now() - interval '5 years' where id = $1`, [oldOpen]);

    const purge = async () =>
      (
        await api.db.query<{ user_reports_deleted: number }>(`select user_reports_deleted from private.purge_social_data()`)
      )[0].user_reports_deleted;
    expect(await purge()).toBe(1);
    const left = await api.db.query<{ id: string }>(`select id from private.user_reports order by id`);
    expect(left.map((r) => r.id).sort()).toEqual([recentClosed, oldOpen].sort());
    expect(await purge()).toBe(0);
  });

  it("purging an old conversation keeps the reports about it, with their copies", async () => {
    const a = await going();
    const b = await going();
    const id = await conversation(a, b);
    const [first] = await messageIds(id);
    await report(b, { conversationId: id, messageId: first, reason: "spam" });
    await api.db.query(`update public.conversations set last_message_at = now() - interval '13 months'`);
    await api.db.query(`select private.purge_social_data()`);
    const [row] = await reportRows();
    expect(row).toMatchObject({ conversation_id: null, message_id: null, message_body: "Hi! Keen for the show?" });
  });
});

describe("members without a going list entry", () => {
  it("a member who was never going can't block by a made-up attendee id, but can block by a real one", async () => {
    const outsider = await member(api);
    const a = await going();
    expect((await block(outsider, { attendeeId: crypto.randomUUID() })).status).toBe(404);
    expect((await block(outsider, { attendeeId: a.attendeeId })).status).toBe(201);
  });
});
