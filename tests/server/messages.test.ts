import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { deleteMyProfile } from "@/lib/server/handlers/profiles";
import {
  declineConversation,
  getMessages,
  getUnreadCount,
  listConversations,
  markConversationRead,
  MESSAGE_PAGE_SIZE,
  MESSAGE_RATE_LIMIT,
  REQUEST_RATE_LIMIT,
  sendMessage,
  startConversation,
} from "@/lib/server/handlers/messages";
import type { EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { goingMember, member, optIn, suspend, type GoingMember, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
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

const going = (options: { displayName?: string } = {}, e: EventRecord = event) => goingMember(api, e, options);
const start = (from: Token, attendeeId: unknown, body: unknown = "Hi! Keen for the show?") =>
  api.call(startConversation, { token: from.token, body: { attendeeId, body } });
const send = (from: Token, conversationId: string, body: unknown = "Sounds good") =>
  api.call(sendMessage, { token: from.token, params: { conversationId }, body: { body } });
const thread = (m: Token, conversationId: string, query?: Record<string, string>) =>
  api.call(getMessages, { token: m.token, params: { conversationId }, query });
const list = (m: Token, query?: Record<string, string>) => api.call(listConversations, { token: m.token, query });
const decline = (m: Token, conversationId: string) =>
  api.call(declineConversation, { token: m.token, params: { conversationId }, method: "POST" });
const read = (m: Token, conversationId: string, body: Record<string, unknown> = {}) =>
  api.call(markConversationRead, { token: m.token, params: { conversationId }, body });
const unread = async (m: Token) => (await api.call(getUnreadCount, { token: m.token })).body.count as number;

/** A requests B; returns the conversation id. */
async function requested(a: Token, b: GoingMember, body?: string) {
  const res = await start(a, b.attendeeId, body);
  expect(res.status).toBe(201);
  return res.body.conversationId as string;
}

/** A requests B, B replies: an active conversation. */
async function accepted(a: Token, b: GoingMember) {
  const id = await requested(a, b);
  expect((await send(b, id, "Yes!")).status).toBe(201);
  return id;
}

async function conversationRows() {
  return api.db.query<{ id: string; status: string }>(`select id, status from public.conversations order by created_at`);
}

async function messageCount() {
  const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.messages`);
  return n;
}

async function endEvent(e: EventRecord = event) {
  await api.db.query(
    `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`,
    [e.eventId],
  );
}

function expectNoIdentifiers(body: unknown, members: { userId: string; email: string }[]) {
  const raw = JSON.stringify(body);
  for (const m of members) {
    expect(raw).not.toContain(m.userId);
    expect(raw.toLowerCase()).not.toContain(m.email.toLowerCase());
  }
}

describe("starting a conversation: who can message whom", () => {
  it("two members going to the same open event: a request, seen from both sides", async () => {
    const a = await going({ displayName: "Ada" });
    const b = await going({ displayName: "Grace" });

    const res = await start(a, b.attendeeId, "  Hi Grace!\r\nSee you there?  ");
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual([
      "conversationId",
      "event",
      "lastMessage",
      "otherDisplayName",
      "status",
      "unread",
    ]);
    expect(res.body).toMatchObject({
      otherDisplayName: "Grace",
      status: "request_sent",
      event: { title: event.title, slug: event.slug },
      lastMessage: { preview: "Hi Grace!\nSee you there?", fromYou: true },
      unread: false,
    });
    expect(Object.keys(res.body.lastMessage).sort()).toEqual(["fromYou", "preview", "sentAt"]);
    expect(Object.keys(res.body.event).sort()).toEqual(["slug", "title"]);

    const theirs = await list(b);
    expect(theirs.status).toBe(200);
    expect(theirs.headers.get("cache-control")).toBe("private, no-store");
    const count = await api.call(getUnreadCount, { token: b.token });
    expect(count.body).toEqual({ count: 1 });
    expect(count.headers.get("cache-control")).toBe("private, no-store");
    expect(theirs.body.items).toHaveLength(1);
    expect(theirs.body.items[0]).toMatchObject({
      conversationId: res.body.conversationId,
      otherDisplayName: "Ada",
      status: "request_received",
      lastMessage: { preview: "Hi Grace!\nSee you there?", fromYou: false },
      unread: true,
    });
    expectNoIdentifiers([res.body, theirs.body, (await list(a)).body], [a, b]);
    expect(await messageCount()).toBe(1);
  });

  it("needs a signed-in member with a verified email", async () => {
    const b = await going();
    expect((await api.call(startConversation, { body: { attendeeId: b.attendeeId, body: "Hi" } })).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await start(unverified, b.attendeeId)).status).toBe(403);
    expect(await conversationRows()).toEqual([]);
  });

  it("needs the sender to be opted in to that same event (403)", async () => {
    const b = await going();
    // A ticket holder with a profile who hasn't opted in.
    const quiet = await member(api);
    await insertOrder(api, event, quiet.email);
    expect((await start(quiet, b.attendeeId)).status).toBe(403);
    // No profile at all.
    const noProfile = await member(api, { profile: false });
    expect((await start(noProfile, b.attendeeId)).status).toBe(403);
    // Going, but to a different event.
    const other = await publishedEvent(api, organiser, admin, { title: "Other night" });
    const elsewhere = await going({}, other);
    const res = await start(elsewhere, b.attendeeId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only message people going to the same event as you.");
    expect(await conversationRows()).toEqual([]);
  });

  it("messages someone on a shared event even if the ids come from different events' lists", async () => {
    // Both are going to two events; the attendeeId from either works.
    const second = await publishedEvent(api, organiser, admin, { title: "Second" });
    const a = await going();
    const b = await going();
    await optIn(api, a, second);
    const bOnSecond = await optIn(api, b, second);
    expect((await start(a, bOnSecond)).status).toBe(201);
    const [row] = await api.db.query<{ event_id: string }>(`select event_id from public.conversations`);
    expect(row.event_id).toBe(second.eventId);
  });

  it("is a 404 for an unknown or malformed attendeeId, and a 400 when it's missing", async () => {
    const a = await going();
    const unknown = await start(a, crypto.randomUUID());
    expect(unknown.status).toBe(404);
    expect((await start(a, "not-a-uuid")).status).toBe(404);
    const missing = await start(a, undefined);
    expect(missing.status).toBe(400);
    expect(missing.body.fieldErrors.attendeeId).toBeDefined();
    expect((await start(a, 42)).status).toBe(400);
  });

  it("is a 404 once the event has ended, is unpublished, or has Who's Going switched off", async () => {
    const a = await going();
    const b = await going();
    await api.db.query(`update public.events set whos_going_enabled = false where id = $1`, [event.eventId]);
    expect((await start(a, b.attendeeId)).status).toBe(404);
    await api.db.query(`update public.events set whos_going_enabled = true where id = $1`, [event.eventId]);
    await endEvent();
    expect((await start(a, b.attendeeId)).status).toBe(404);

    const other = await publishedEvent(api, organiser, admin, { title: "Other" });
    const c = await going({}, other);
    const d = await going({}, other);
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: other.eventId }, body: { reason: "x" } });
    expect((await start(c, d.attendeeId)).status).toBe(404);
    expect(await conversationRows()).toEqual([]);
  });

  it("can't message yourself (400)", async () => {
    const a = await going();
    const res = await start(a, a.attendeeId);
    expect(res.status).toBe(400);
    expect(await conversationRows()).toEqual([]);
  });

  it("a suspended sender gets 403; a suspended recipient looks like an unknown member (404)", async () => {
    const a = await going();
    const b = await going();
    await suspend(api, a);
    expect((await start(a, b.attendeeId)).status).toBe(403);
    const c = await going();
    const res = await start(c, a.attendeeId);
    expect(res.status).toBe(404);
    expect(res.body).toEqual((await start(c, crypto.randomUUID())).body);
    expect(await conversationRows()).toEqual([]);
  });

  it("one conversation per pair: a second request either way is a 409", async () => {
    const a = await going();
    const b = await going();
    await requested(a, b);
    expect((await start(a, b.attendeeId)).status).toBe(409);
    expect((await start(b, a.attendeeId)).status).toBe(409);
    expect(await conversationRows()).toHaveLength(1);
    expect(await messageCount()).toBe(1);
  });

  it("simultaneous requests each way: exactly one wins, the other gets 409", async () => {
    const a = await going();
    const b = await going();
    const results = await Promise.all([start(a, b.attendeeId), start(b, a.attendeeId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await conversationRows()).toHaveLength(1);
    expect(await messageCount()).toBe(1);
  });

  it("concurrent requests from one member to another: one conversation, one message", async () => {
    const a = await going();
    const b = await going();
    const results = await Promise.all(Array.from({ length: 5 }, () => start(a, b.attendeeId)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await conversationRows()).toHaveLength(1);
    expect(await messageCount()).toBe(1);
  });
});

// Needs two sessions at once, which only a real server has (PGlite is one
// connection). Run with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("mutual requests, forced interleaving (real Postgres only)", () => {
  it("the second insert hits the unique pair, returns 'exists' and keeps none of its rate-limit hits", async () => {
    const a = await going();
    const b = await going();
    const first = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const second = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const call = (sql: postgres.Sql, from: Member, attendeeId: string) =>
      sql.unsafe(`select result from private.request_conversation($1, $2, 'hi', 10, '1 day', 60, '1 hour')`, [
        from.userId,
        attendeeId,
      ]);
    try {
      // A's request, left uncommitted: invisible to B's "exists" check.
      await first.unsafe("begin");
      expect((await call(first, a, b.attendeeId))[0].result).toBe("sent");

      const [{ pid }] = await second.unsafe("select pg_backend_pid() as pid");
      // postgres.js queries are lazy: execute() sends it now, without awaiting the result.
      const pending = call(second, b, a.attendeeId).execute();
      // Wait until B's insert is blocked on A's uncommitted row in the unique index.
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") break;
        if (i > 200) throw new Error("B's request never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
      await first.unsafe("commit");
      expect((await pending)[0].result).toBe("exists");
    } finally {
      await first.end();
      await second.end();
    }
    expect(await conversationRows()).toHaveLength(1);
    expect(await messageCount()).toBe(1);
    expect(
      await api.db.query(`select bucket from private.rate_limits where user_id = $1`, [b.userId]),
    ).toEqual([]);
  });

  it("a member's open request doesn't hold up someone else's request to them (no lock that could deadlock)", async () => {
    // A's request to C is in flight (A's profile locked). B requesting A needs
    // a key-share lock on A's profile for the foreign key. The sender's lock is
    // `for no key update`, which allows that; `for update` would block B until
    // A commits, and two members requesting each other could then deadlock.
    const a = await going();
    const b = await going();
    const c = await going();
    const first = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const second = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await first.unsafe("begin");
      const [held] = await first.unsafe(
        `select result from private.request_conversation($1, $2, 'hi', 10, '1 day', 60, '1 hour')`,
        [a.userId, c.attendeeId],
      );
      expect(held.result).toBe("sent");
      const pending = second
        .unsafe(`select result from private.request_conversation($1, $2, 'hi', 10, '1 day', 60, '1 hour')`, [
          b.userId,
          a.attendeeId,
        ])
        .execute();
      const outcome = await Promise.race([
        pending.then((rows) => rows[0].result as string),
        new Promise<string>((r) => setTimeout(() => r("blocked"), 2000)),
      ]);
      await first.unsafe("commit");
      await pending;
      expect(outcome).toBe("sent");
    } finally {
      await first.end();
      await second.end();
    }
    expect(await conversationRows()).toHaveLength(2);
  });
});

describe("message text", () => {
  let a: GoingMember;
  let b: GoingMember;
  beforeEach(async () => {
    a = await going();
    b = await going();
  });

  it.each([
    ["empty", ""],
    ["only whitespace", "  \n\t "],
    ["not a string", 12],
    ["only invisible characters", "​​"],
    ["a control character", "hi\u0007there"],
    ["a bidi override", "hi ‮ereht"],
    ["over 1000 characters", "x".repeat(1001)],
    ["stacked combining marks", `Z${"́".repeat(8)}`],
  ])("rejects a message that's %s (400)", async (_label, body) => {
    const res = await start(a, b.attendeeId, body);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.body).toBeDefined();
    expect(await conversationRows()).toEqual([]);
  });

  it.each(["see https://example.com", "www.example.org", "my site: example.com.au", "example[.]com"])(
    "a first message can't contain links: %s",
    async (body) => {
      const res = await start(a, b.attendeeId, body);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.body).toMatch(/links/);
      expect(await conversationRows()).toEqual([]);
    },
  );

  it("replies may contain links", async () => {
    const id = await requested(a, b);
    const res = await send(b, id, "Tickets: https://sheltuh.com.au/events/x");
    expect(res.status).toBe(201);
    expect(res.body.body).toBe("Tickets: https://sheltuh.com.au/events/x");
  });

  it("accepts exactly 1000 characters (counted as code points), emoji with joiners, and normalises whitespace", async () => {
    const long = "😀".repeat(1000);
    const id = await requested(a, b, long);
    const [{ body }] = await api.db.query<{ body: string }>(`select body from public.messages`);
    expect(body).toBe(long);
    const res = await send(b, id, "Family: 👨‍👩‍👧\r\n\r\n\r\n\r\nSee you   \nthere\t");
    expect(res.status).toBe(201);
    expect(res.body.body).toBe("Family: 👨‍👩‍👧\n\nSee you\nthere");
  });

  it("the database refuses an over-long or empty body even if the API were bypassed", async () => {
    const id = await requested(a, b);
    for (const body of ["", "x".repeat(1001)]) {
      await expect(
        api.db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)`, [
          id,
          a.userId,
          body,
        ]),
      ).rejects.toThrow();
    }
  });
});

describe("requests: waiting, replying, declining", () => {
  it("the sender waits (409) until a reply accepts the request; then both can talk", async () => {
    const a = await going({ displayName: "Ada" });
    const b = await going({ displayName: "Grace" });
    const id = await requested(a, b);

    const early = await send(a, id, "Hello??");
    expect(early.status).toBe(409);
    expect(await messageCount()).toBe(1);

    const reply = await send(b, id, "Hey Ada");
    expect(reply.status).toBe(201);
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(reply.body).sort()).toEqual(["body", "fromYou", "messageId", "sentAt"]);
    expect(reply.body).toMatchObject({ body: "Hey Ada", fromYou: true });
    expect(reply.body.messageId).toMatch(/^\d+$/);

    for (const m of [a, b]) expect((await list(m)).body.items[0].status).toBe("active");
    expect((await send(a, id, "Great")).status).toBe(201);
    expect((await send(a, id, "And again")).status).toBe(201);

    const res = await thread(a, id);
    expect(res.body.items.map((msg: { body: string; fromYou: boolean }) => [msg.body, msg.fromYou])).toEqual([
      ["Hi! Keen for the show?", true],
      ["Hey Ada", false],
      ["Great", true],
      ["And again", true],
    ]);
  });

  it("declining is silent: it vanishes for the recipient, and nothing changes for the sender", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    const before = { list: (await list(a)).body, thread: (await thread(a, id)).body, send: await send(a, id, "?") };

    const res = await decline(b, id);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await conversationRows())[0].status).toBe("declined");

    // The sender sees exactly what they saw before.
    expect((await list(a)).body).toEqual(before.list);
    expect((await thread(a, id)).body).toEqual(before.thread);
    const after = await send(a, id, "?");
    expect(after.status).toBe(before.send.status);
    expect(after.body).toEqual(before.send.body);
    expect((await start(a, b.attendeeId)).status).toBe(409);

    // The recipient no longer sees it at all.
    expect((await list(b)).body.items).toEqual([]);
    expect(await unread(b)).toBe(0);
    expect((await thread(b, id)).status).toBe(404);
    expect((await send(b, id, "Actually, hi")).status).toBe(404);
    expect((await read(b, id)).status).toBe(404);
    // Declining again is harmless.
    expect((await decline(b, id)).status).toBe(204);
    expect(await messageCount()).toBe(1);
  });

  it("only the recipient can decline, and only a request (409); strangers get 404", async () => {
    const a = await going();
    const b = await going();
    const stranger = await going();
    const id = await requested(a, b);
    expect((await decline(a, id)).status).toBe(409);
    expect((await decline(stranger, id)).status).toBe(404);
    expect((await decline(b, crypto.randomUUID())).status).toBe(404);
    expect((await decline(b, "nope")).status).toBe(404);
    expect((await api.call(declineConversation, { params: { conversationId: id }, method: "POST" })).status).toBe(401);

    await send(b, id, "Hi back");
    expect((await decline(b, id)).status).toBe(409);
    expect((await conversationRows())[0].status).toBe("accepted");
  });

  it("a reply and a decline racing: exactly one wins", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    const [replied, declined] = await Promise.all([send(b, id, "Hi"), decline(b, id)]);
    const [{ status }] = await conversationRows();
    if (status === "accepted") {
      expect([replied.status, declined.status]).toEqual([201, 409]);
      expect(await messageCount()).toBe(2);
    } else {
      expect(status).toBe("declined");
      expect([replied.status, declined.status]).toEqual([404, 204]);
      expect(await messageCount()).toBe(1);
    }
  });

  it("an accepted conversation carries on after the event ends, is unpublished, or either stops going", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(a, b);
    await api.db.query(`delete from public.event_attendees`);
    await endEvent();
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, body: { reason: "x" } });
    expect((await send(a, id, "Still here")).status).toBe(201);
    const summary = (await list(b)).body.items[0];
    expect(summary.status).toBe("active");
    // The event is no longer published, so it isn't named.
    expect(summary.event).toBeUndefined();
  });

  it("a request can still be answered after the event has ended", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    await endEvent();
    expect((await send(b, id, "Sorry, late reply")).status).toBe(201);
  });
});

describe("only participants: everyone else gets 404", () => {
  it("GET/POST messages, read and decline are 404 for a stranger, an unknown id and a malformed id", async () => {
    const a = await going();
    const b = await going();
    const stranger = await going();
    const id = await accepted(a, b);

    for (const conversationId of [id, crypto.randomUUID(), "not-a-uuid"]) {
      const who = conversationId === id ? stranger : a;
      expect((await thread(who, conversationId)).status).toBe(404);
      expect((await send(who, conversationId)).status).toBe(404);
      expect((await read(who, conversationId)).status).toBe(404);
      expect((await decline(who, conversationId)).status).toBe(404);
    }
    expect((await list(stranger)).body.items).toEqual([]);
    expect(await messageCount()).toBe(2);
  });

  it("needs a signed-in, verified member for listing, reading, sending and the unread count", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    expect((await api.call(listConversations, {})).status).toBe(401);
    expect((await api.call(getMessages, { params: { conversationId: id } })).status).toBe(401);
    expect((await api.call(sendMessage, { params: { conversationId: id }, body: { body: "x" } })).status).toBe(401);
    expect((await api.call(getUnreadCount, {})).status).toBe(401);
    expect(
      (await api.call(markConversationRead, { params: { conversationId: id }, body: {}, method: "POST" })).status,
    ).toBe(401);

    // Same account, email no longer verified (e.g. changed and unconfirmed).
    const unverified = {
      token: api.tokenFor({ userId: b.userId, email: b.email, emailVerified: false, isAdmin: false }),
    };
    expect((await list(unverified)).status).toBe(403);
    expect((await thread(unverified, id)).status).toBe(403);
    expect((await send(unverified, id)).status).toBe(403);
    // Declining never needs verification.
    expect((await decline(unverified, id)).status).toBe(204);
  });
});

describe("the conversation list", () => {
  it("is ordered by latest activity, and previews the first 140 characters of the newest message", async () => {
    const a = await going();
    const b = await going({ displayName: "B" });
    const c = await going({ displayName: "C" });
    const ab = await accepted(a, b);
    const ac = await accepted(a, c);
    const names = async () => (await list(a)).body.items.map((i: { otherDisplayName: string }) => i.otherDisplayName);
    expect(await names()).toEqual(["C", "B"]);

    const long = `${"a".repeat(139)}😀 and more`;
    await send(b, ab, long);
    expect(await names()).toEqual(["B", "C"]);
    const [top] = (await list(a)).body.items;
    expect(top.lastMessage).toMatchObject({ preview: `${"a".repeat(139)}😀`, fromYou: false });
    expect((await thread(a, ab)).body.items.at(-1).body).toBe(long);

    await send(a, ac, "back to C");
    expect(await names()).toEqual(["C", "B"]);
  });

  it("pages with a cursor", async () => {
    const a = await going();
    for (let i = 0; i < 3; i++) await accepted(a, await going());
    const first = await list(a, { limit: "2" });
    expect(first.body.items).toHaveLength(2);
    const second = await list(a, { limit: "2", cursor: first.body.nextCursor });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeUndefined();
    expect((await list(a, { cursor: "garbage" })).status).toBe(400);
  });
});

describe("reading a conversation", () => {
  async function bulkMessages(conversationId: string, from: Member, to: Member, count: number) {
    // Alternating senders, oldest first.
    await api.db.query(
      `insert into public.messages (conversation_id, sender_id, body)
       select $1, case when g % 2 = 0 then $2::uuid else $3::uuid end, 'msg ' || g from generate_series(1, $4::int) g`,
      [conversationId, from.userId, to.userId, count],
    );
  }

  it("pages: newest 50 by default, `before` goes back, `after` goes forward, all oldest first", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(a, b); // 2 messages
    await bulkMessages(id, a, b, 118); // 120 in total

    const newest = await thread(a, id);
    expect(newest.status).toBe(200);
    expect(newest.headers.get("cache-control")).toBe("private, no-store");
    expect(newest.body.items).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(newest.body.hasMore).toBe(true);
    expect(newest.body.items.at(-1).body).toBe("msg 118");
    expect(newest.body.items[0].body).toBe("msg 69");
    expect(newest.body.conversation.conversationId).toBe(id);
    const ids = newest.body.items.map((m: { messageId: string }) => BigInt(m.messageId));
    expect([...ids].sort((x, y) => (x < y ? -1 : 1))).toEqual(ids);

    const older = await thread(a, id, { before: newest.body.items[0].messageId });
    expect(older.body.items.map((m: { body: string }) => m.body)[0]).toBe("msg 19");
    expect(older.body.items.at(-1).body).toBe("msg 68");
    expect(older.body.hasMore).toBe(true);
    const oldest = await thread(a, id, { before: older.body.items[0].messageId });
    expect(oldest.body.items).toHaveLength(20);
    expect(oldest.body.items[0].body).toBe("Hi! Keen for the show?");
    expect(oldest.body.hasMore).toBe(false);

    const forward = await thread(a, id, { after: oldest.body.items[0].messageId });
    expect(forward.body.items).toHaveLength(50);
    expect(forward.body.items[0].body).toBe("Yes!");
    expect(forward.body.hasMore).toBe(true);
    const caughtUp = await thread(a, id, { after: newest.body.items.at(-1).messageId });
    expect(caughtUp.body).toMatchObject({ items: [], hasMore: false });
  });

  it("rejects malformed cursors, and both at once (400)", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    const queries: Record<string, string>[] = [{ after: "abc" }, { before: "-1" }, { after: "0" }, { after: "1", before: "5" }];
    for (const query of queries) {
      expect((await thread(a, id, query)).status).toBe(400);
    }
  });

  it("never includes a user id or email, anywhere", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(a, b);
    for (const m of [a, b]) {
      expectNoIdentifiers((await thread(m, id)).body, [a, b]);
      expectNoIdentifiers((await list(m)).body, [a, b]);
    }
    expectNoIdentifiers((await send(a, id, "x")).body, [a, b]);
  });
});

describe("unread", () => {
  it("counts conversations with unread messages from the other member; marking read clears it", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    const ab = await requested(a, b);
    await requested(c, b);
    expect(await unread(b)).toBe(2);
    expect(await unread(a)).toBe(0); // your own messages are never unread

    const res = await read(b, ab);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await unread(b)).toBe(1);
    expect((await list(b)).body.items.find((i: { conversationId: string }) => i.conversationId === ab).unread).toBe(
      false,
    );

    // B replies: now A has something unread.
    const reply = await send(b, ab, "Hi");
    expect(await unread(a)).toBe(1);
    await send(b, ab, "You there?");
    // Reading up to the first reply leaves the second unread.
    await read(a, ab, { lastReadMessageId: reply.body.messageId });
    expect(await unread(a)).toBe(1);
    await read(a, ab);
    expect(await unread(a)).toBe(0);
    // Never moves backwards.
    await read(a, ab, { lastReadMessageId: "1" });
    expect(await unread(a)).toBe(0);
    // Can't be pushed past the newest message to pre-read future ones.
    await read(a, ab, { lastReadMessageId: "999999999" });
    await send(b, ab, "New one");
    expect(await unread(a)).toBe(1);
  });

  it("for either member of the pair: never backwards, never past the newest message", async () => {
    // user_low/user_high depend on the random ids, so check both sides.
    const a = await going();
    const b = await going();
    const id = await accepted(a, b);
    for (const [me, them] of [
      [a, b],
      [b, a],
    ]) {
      await send(them, id, "one");
      expect(await unread(me)).toBe(1);
      await read(me, id);
      expect(await unread(me)).toBe(0);
      await read(me, id, { lastReadMessageId: "1" });
      expect(await unread(me)).toBe(0);
      await read(me, id, { lastReadMessageId: "999999999" });
      await send(them, id, "two");
      expect(await unread(me)).toBe(1);
      await read(me, id);
    }
  });

  it("your own messages are never unread, whatever your read marker says", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(a, b);
    await read(a, id);
    // Written directly, so the sender's read marker isn't moved.
    await api.db.query(`insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'mine')`, [
      id,
      a.userId,
    ]);
    expect(await unread(a)).toBe(0);
    expect(await unread(b)).toBe(1);
  });

  it("rejects a malformed lastReadMessageId (400)", async () => {
    const a = await going();
    const b = await going();
    const id = await requested(a, b);
    expect((await read(b, id, { lastReadMessageId: "abc" })).status).toBe(400);
    expect((await read(b, id, { lastReadMessageId: 5 })).status).toBe(400);
  });
});

describe("rate limits", () => {
  it(`allows ${REQUEST_RATE_LIMIT.hits} new requests per ${REQUEST_RATE_LIMIT.window}, then 429`, async () => {
    const a = await going();
    const others: GoingMember[] = [];
    for (let i = 0; i <= REQUEST_RATE_LIMIT.hits; i++) others.push(await going());

    for (const o of others.slice(0, REQUEST_RATE_LIMIT.hits)) expect((await start(a, o.attendeeId)).status).toBe(201);
    const limited = await start(a, others[REQUEST_RATE_LIMIT.hits].attendeeId);
    expect(limited.status).toBe(429);
    expect(await conversationRows()).toHaveLength(REQUEST_RATE_LIMIT.hits);
    // Per member: someone else can still send one.
    expect((await start(others[REQUEST_RATE_LIMIT.hits], others[0].attendeeId)).status).toBe(201);

    await api.db.query(
      `update private.rate_limits set window_started_at = window_started_at - $2::interval where user_id = $1`,
      [a.userId, REQUEST_RATE_LIMIT.window],
    );
    const again = await going();
    expect((await start(a, again.attendeeId)).status).toBe(201);
  });

  it("refused requests (404, 409, 403, 400) don't use up the allowance", async () => {
    const a = await going();
    const b = await going();
    await requested(a, b);
    for (let i = 0; i < REQUEST_RATE_LIMIT.hits; i++) {
      expect((await start(a, b.attendeeId)).status).toBe(409);
      expect((await start(a, crypto.randomUUID())).status).toBe(404);
      expect((await start(a, a.attendeeId)).status).toBe(400);
    }
    expect((await start(a, (await going()).attendeeId)).status).toBe(201);
  });

  it(`allows ${MESSAGE_RATE_LIMIT.hits} messages per ${MESSAGE_RATE_LIMIT.window}, requests included, then 429`, async () => {
    const a = await going();
    const b = await going();
    const id = await requested(b, a); // B's request: 1 of B's messages
    for (let i = 0; i < MESSAGE_RATE_LIMIT.hits; i++) expect((await send(a, id, `m${i}`)).status).toBe(201);
    const limited = await send(a, id, "one too many");
    expect(limited.status).toBe(429);
    expect(await messageCount()).toBe(1 + MESSAGE_RATE_LIMIT.hits);

    // B has only used 1.
    expect((await send(b, id, "hi")).status).toBe(201);
    // B's request counted: B can send hits - 2 more.
    for (let i = 0; i < MESSAGE_RATE_LIMIT.hits - 2; i++) expect((await send(b, id, `b${i}`)).status).toBe(201);
    expect((await send(b, id, "limit")).status).toBe(429);

    await api.db.query(
      `update private.rate_limits set window_started_at = window_started_at - $2::interval where user_id = $1`,
      [a.userId, MESSAGE_RATE_LIMIT.window],
    );
    expect((await send(a, id, "new hour")).status).toBe(201);
  });

  it("a request is refused (429) when the message allowance is used up, without using a request", async () => {
    const a = await going();
    const b = await going();
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'messages', now(), $2)`,
      [a.userId, MESSAGE_RATE_LIMIT.hits],
    );
    expect((await start(a, b.attendeeId)).status).toBe(429);
    expect(await conversationRows()).toEqual([]);
    const buckets = await api.db.query(`select bucket, hits from private.rate_limits where user_id = $1 order by 1`, [
      a.userId,
    ]);
    expect(buckets).toEqual([{ bucket: "messages", hits: MESSAGE_RATE_LIMIT.hits }]);
  });

  it("concurrent sends can't exceed the limit", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(b, a); // A has sent 1
    const results = await Promise.all(Array.from({ length: MESSAGE_RATE_LIMIT.hits + 5 }, (_, i) => send(a, id, `${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(MESSAGE_RATE_LIMIT.hits - 1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(6);
  });
});

describe("suspension", () => {
  it("a suspended member can't send (403); their conversations disappear for everyone else", async () => {
    const a = await going();
    const b = await going();
    const id = await accepted(a, b);
    await suspend(api, a);

    expect((await send(a, id)).status).toBe(403);
    expect((await list(b)).body.items).toEqual([]);
    expect((await thread(b, id)).status).toBe(404);
    expect((await send(b, id)).status).toBe(404);
    expect(await unread(b)).toBe(0);

    await api.db.query(`delete from private.social_suspensions where user_id = $1`, [a.userId]);
    expect((await list(b)).body.items).toHaveLength(1);
    expect((await send(a, id)).status).toBe(201);
  });
});

describe("deletion and retention", () => {
  it("deleting a profile deletes their conversations and messages, for both members", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    await accepted(a, b);
    const bc = await accepted(b, c);
    expect((await api.call(deleteMyProfile, { token: a.token, method: "DELETE" })).status).toBe(204);
    expect(await conversationRows()).toEqual([{ id: bc, status: "accepted" }]);
    expect(await messageCount()).toBe(2);
    expect((await list(b)).body.items.map((i: { conversationId: string }) => i.conversationId)).toEqual([bc]);
  });

  it("private.purge_social_data deletes conversations 12 months after their last message", async () => {
    const a = await going();
    const b = await going();
    const c = await going();
    const old = await accepted(a, b);
    const recent = await accepted(a, c);
    await api.db.query(
      `update public.conversations set last_message_at = now() - interval '12 months' - interval '1 day' where id = $1`,
      [old],
    );
    await api.db.query(
      `update public.conversations set last_message_at = now() - interval '12 months' + interval '1 day' where id = $1`,
      [recent],
    );
    const purge = async () =>
      (
        await api.db.query<{ conversations_deleted: number }>(
          `select conversations_deleted from private.purge_social_data()`,
        )
      )[0].conversations_deleted;
    expect(await purge()).toBe(1);
    expect((await conversationRows()).map((r) => r.id)).toEqual([recent]);
    expect(await messageCount()).toBe(2);
    expect(await purge()).toBe(0);
  });
});

describe("private.send_message and private.request_conversation (database functions)", () => {
  it("return each outcome directly", async () => {
    const a = await going();
    const b = await going();
    const request = async (from: Member, attendeeId: string) =>
      (
        await api.db.query<{ result: string }>(
          `select result from private.request_conversation($1, $2, 'hi', 10, '1 day', 60, '1 hour')`,
          [from.userId, attendeeId],
        )
      )[0].result;
    const sendAs = async (from: Member, conversationId: string) =>
      (
        await api.db.query<{ result: string }>(
          `select result from private.send_message($1, $2, 'hi', 60, '1 hour')`,
          [conversationId, from.userId],
        )
      )[0].result;

    expect(await request(a, a.attendeeId)).toBe("self");
    expect(await request(a, crypto.randomUUID())).toBe("unavailable");
    expect(await request(a, b.attendeeId)).toBe("sent");
    expect(await request(a, b.attendeeId)).toBe("exists");
    const [{ id }] = await conversationRows();
    expect(await sendAs(a, id)).toBe("awaiting_reply");
    expect(await sendAs(b, id)).toBe("sent");
    expect(await sendAs(a, id)).toBe("sent");
    expect(await sendAs(a, crypto.randomUUID())).toBe("not_found");
    await suspend(api, b);
    expect(await sendAs(b, id)).toBe("sender_suspended");
    expect(await sendAs(a, id)).toBe("not_found");
  });
});
