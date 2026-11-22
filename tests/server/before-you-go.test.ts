import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEFORE_YOU_GO_LABEL_MAX_LENGTH,
  BEFORE_YOU_GO_MAX_ITEMS,
  BEFORE_YOU_GO_SUGGESTED_LABELS,
  BEFORE_YOU_GO_TOO_MANY,
  BEFORE_YOU_GO_VALUE_MAX_LENGTH,
  normaliseBeforeYouGo,
  validateBeforeYouGo,
  type BeforeYouGoItem,
} from "@/lib/before-you-go";
import { adminListEvents } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { createEventDraft, getMyEvent, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, getOrderBySession } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { buildEventReminderEmail } from "@/lib/server/event-reminder-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import {
  approvedOrganiser,
  draftEvent,
  eventInput,
  insertOrder,
  publishedEvent,
  setUpPayouts,
  signUpAdmin,
  withoutHostCard,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * "Before you go": the organiser's rows for people going, a label and a value
 * each (docs/architecture.md, "Before you go";
 * supabase/migrations/20261204000000_event_before_you_go.sql;
 * lib/before-you-go.ts, lib/server/event-input.ts parseBeforeYouGo).
 */

// The email builders, unchanged but watched: the outbox and the free booking must hand them the rows.
vi.mock("@/lib/server/ticket-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/ticket-email")>();
  return { ...real, buildTicketEmail: vi.fn(real.buildTicketEmail) };
});
vi.mock("@/lib/server/event-reminder-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/event-reminder-email")>();
  return { ...real, buildEventReminderEmail: vi.fn(real.buildEventReminderEmail) };
});
vi.mock("@/lib/server/free-confirmation-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/free-confirmation-email")>();
  return { ...real, buildFreeConfirmationEmail: vi.fn(real.buildFreeConfirmationEmail) };
});

/** The owner's reference rows. */
const ROWS: BeforeYouGoItem[] = [
  { label: "Entry", value: "7:30 pm – 10:30 pm" },
  { label: "Age", value: "18+ · Photo ID required" },
  { label: "Extras", value: "Free earplugs at the bar" },
];
const row = (label: string, value: string): BeforeYouGoItem => ({ label, value });

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  vi.mocked(buildTicketEmail).mockClear();
  vi.mocked(buildEventReminderEmail).mockClear();
  vi.mocked(buildFreeConfirmationEmail).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const create = (body: Record<string, unknown>, token = organiser.token) =>
  api.call(createEventDraft, { token, body: eventInput(body) });
const patch = (eventId: string, body: Record<string, unknown>, token = organiser.token) =>
  api.call(updateEventDraft, { token, params: { eventId }, body: eventInput(body), method: "PATCH" });

/** The API's field error for these rows on a create (and that nothing else failed). */
async function refusal(beforeYouGo: unknown): Promise<string> {
  const res = await create({ title: `Refused ${crypto.randomUUID().slice(0, 6)}`, beforeYouGo });
  expect(res.status, JSON.stringify(beforeYouGo)).toBe(400);
  expect(Object.keys(res.body.fieldErrors), JSON.stringify(beforeYouGo)).toEqual(["beforeYouGo"]);
  return res.body.fieldErrors.beforeYouGo as string;
}

/** The rows a create stores. */
async function accepted(beforeYouGo: unknown): Promise<BeforeYouGoItem[] | undefined> {
  const res = await create({ title: `Taken ${crypto.randomUUID().slice(0, 6)}`, beforeYouGo });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(await stored(res.body.eventId)).toEqual(res.body.beforeYouGo ?? null);
  return res.body.beforeYouGo;
}

/** The organiser's submit for review (their paid event needs payouts first). */
async function submit(eventId: string) {
  await setUpPayouts(api, organiser.organiserId);
  const res = await api.call(submitEventForReview, { token: organiser.token, params: { eventId }, method: "POST" });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("pending_review");
}

async function stored(eventId: string): Promise<unknown> {
  const [r] = await api.db.query<{ rows: unknown }>(`select before_you_go as rows from public.events where id = $1`, [eventId]);
  return r.rows;
}

describe("the organiser's create and edit", () => {
  it("stores the rows as jsonb, in order, returns them on the organiser's record, and has no field without them", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    expect(event.beforeYouGo).toEqual(ROWS);
    expect(await stored(event.eventId)).toEqual(ROWS);
    const [{ type }] = await api.db.query<{ type: string }>(
      `select jsonb_typeof(before_you_go) as type from public.events where id = $1`,
      [event.eventId],
    );
    expect(type).toBe("array");
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.beforeYouGo).toEqual(ROWS);

    const none = await draftEvent(api, organiser, { title: "No rows" });
    expect(none).not.toHaveProperty("beforeYouGo");
    expect(await stored(none.eventId)).toBeNull();
  });

  it("cleans each part: NFC, whitespace runs (line breaks and tabs too) to one space, trimmed; the label as typed", async () => {
    const rows = await accepted([
      row("  entry\t ", " 7:30 pm  –\n10:30 pm "),
      row("AgE", "Café\r\nonly"),
      row(" Extras　", "Free  earplugs"),
    ]);
    expect(rows).toEqual([row("entry", "7:30 pm – 10:30 pm"), row("AgE", "Café only"), row("Extras", "Free earplugs")]);
  });

  it("drops rows with both parts blank, keeps the order, and stores null, [] and all-blank as none", async () => {
    expect(await accepted([row("", ""), ROWS[0], row("  ", "\n\t"), ROWS[1]])).toEqual([ROWS[0], ROWS[1]]);
    for (const none of [null, [], [row("", "")], [row(" ", " "), { label: null, value: null }, {}]]) {
      expect(await accepted(none), JSON.stringify(none)).toBeUndefined();
    }
  });

  it("ignores keys other than label and value", async () => {
    expect(await accepted([{ label: "Entry", value: "7 pm", id: "x", html: "<b>" }])).toEqual([row("Entry", "7 pm")]);
  });

  it("refuses a half-filled row, naming it by its place in the list sent", async () => {
    expect(await refusal([ROWS[0], row("Age", "")])).toBe("Row 2 needs a label and a value.");
    expect(await refusal([row("", ""), row("", "18+")])).toBe("Row 2 needs a label and a value.");
    expect(await refusal([{ label: "Entry" }])).toBe("Row 1 needs a label and a value.");
    expect(await refusal([row("Entry", "   ")])).toBe("Row 1 needs a label and a value.");
  });

  it(`takes up to ${BEFORE_YOU_GO_MAX_ITEMS} rows (blank ones don't count) and refuses a sixth`, async () => {
    const five = Array.from({ length: 5 }, (_, i) => row(`Row ${i + 1}`, `Value ${i + 1}`));
    expect(await accepted(five)).toEqual(five);
    expect(await accepted([...five, row("", "")])).toEqual(five);
    expect(await refusal([...five, row("Six", "Too many")])).toBe(BEFORE_YOU_GO_TOO_MANY);
    // A huge list is refused before any row is looked at.
    expect(await refusal(Array.from({ length: 1000 }, () => row("", "")))).toBe(BEFORE_YOU_GO_TOO_MANY);
  });

  it(`takes labels up to ${BEFORE_YOU_GO_LABEL_MAX_LENGTH} and values up to ${BEFORE_YOU_GO_VALUE_MAX_LENGTH} characters, counted in code points after NFC`, async () => {
    const L = BEFORE_YOU_GO_LABEL_MAX_LENGTH;
    const V = BEFORE_YOU_GO_VALUE_MAX_LENGTH;
    expect(await accepted([row("a".repeat(L), "b".repeat(V))])).toEqual([row("a".repeat(L), "b".repeat(V))]);
    // Emoji are one code point each (two UTF-16 units), as char_length counts them.
    expect(await accepted([row("🎟".repeat(L), "🎟".repeat(V))])).toHaveLength(1);
    // Spaces cleaning removes don't count.
    expect(await accepted([row(`  ${"a".repeat(L)}  `, `${"b".repeat(V / 2)}    ${"c".repeat(V / 2 - 1)}`)])).toHaveLength(1);

    expect(await refusal([row("a".repeat(L + 1), "x")])).toBe(`Row 1's label must be ${L} characters or fewer.`);
    expect(await refusal([ROWS[0], row("Age", "b".repeat(V + 1))])).toBe(`Row 2's value must be ${V} characters or fewer.`);
    // Raw text past 4 × the limit is refused before any cleaning.
    expect(await refusal([row(" ".repeat(L * 4 + 1), "x")])).toBe(`Row 1's label must be ${L} characters or fewer.`);

    // U+0958 (क़) is a composition exclusion: NFC makes each two code points (U+0915 U+093C). Counted after NFC, as
    // the database counts what's stored.
    const qa = "क़";
    const half = await accepted([row(qa.repeat(L / 2), "x")]);
    expect(Array.from(half![0].label)).toHaveLength(L);
    expect(half![0].label).toBe("क़".repeat(L / 2));
    expect(await refusal([row(qa.repeat(L / 2 + 1), "x")])).toBe(`Row 1's label must be ${L} characters or fewer.`);
    expect(await refusal([row("x", qa.repeat(V / 2 + 1))])).toBe(`Row 1's value must be ${V} characters or fewer.`);
  });

  it("refuses links, web and email addresses in labels and values, disguised or not", async () => {
    const disguised = [
      "https://example.com/door",
      "hxxp://example",
      "www.venue.example",
      "thevenue.com.au/map",
      "ｅｘａｍｐｌｅ．ｃｏｍ",
      "example。com",
      "example．com",
      "example｡com",
      "example . com",
      "example[.]com",
      "venue dot com",
    ];
    for (const text of disguised) {
      expect(await refusal([row("Map", text)])).toBe("Row 1's value can't include links or web addresses.");
      expect(await refusal([row(text.slice(0, 20), "x")])).toMatch(/^Row 1's label can't include links or web addresses\.$/);
    }
    expect(await refusal([row("Ask", "hello [at] venue")])).toBe("Row 1's value can't include email addresses.");
    expect(await refusal([row("Ask", "hello@venue")])).toBe("Row 1's value can't include email addresses.");
    // Times, prices and abbreviations aren't addresses.
    expect(await accepted([row("Entry", "Doors 7.30pm, A$12.50, St. Kilda gate, e.g. side")])).toHaveLength(1);
  });

  it("refuses control, invisible and text-direction characters per part, blank-looking ones included", async () => {
    const refused = ["\u0007", "\u0000", "\u0085", "\u009B", "­", "​", "‎", "‮", "⁦", " ", " ", "⁠", "﻿"];
    for (const ch of refused) {
      expect(await refusal([row(`Do${ch}ors`, "7 pm")])).toBe(
        "Row 1's label can't contain control, invisible or text-direction characters.",
      );
      expect(await refusal([ROWS[0], row("Age", `18${ch}+`)])).toBe(
        "Row 2's value can't contain control, invisible or text-direction characters.",
      );
    }
    // Alone in a part that would otherwise be blank: still refused, not dropped.
    expect(await refusal([row("​", "​")])).toMatch(/^Row 1's label can't contain/);
    // The joiners emoji and several scripts need, and the flag tag sequences, are fine.
    expect(await accepted([row("Crew", "👩‍🎤 and 🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}")])).toHaveLength(1);
    // Stacked marks: refused by the API's own check.
    expect(await refusal([row(`Z${"́".repeat(6)}`, "x")])).toBe(
      "Row 1's label can't stack accents or other marks on one character.",
    );
  });

  it("refuses the default-ignorable characters outside Cf (Hangul fillers, variation selectors), before the blank check", async () => {
    const hidden = (n: number, part: "label" | "value") =>
      `Row ${n}'s ${part} can't contain control, invisible or text-direction characters.`;
    // U+3164 HANGUL FILLER, U+115F HANGUL CHOSEONG FILLER and U+FFA0 HALFWIDTH HANGUL FILLER are letters (Lo),
    // U+180B MONGOLIAN FREE VARIATION SELECTOR ONE a mark (Mn): none is Cf, and each renders as nothing.
    for (const ch of ["\u3164", "\u115F", "\uFFA0", "\u180B"]) {
      const name = `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`;
      // Alone: refused, not taken as a blank (and so dropped) row, nor as text.
      expect(await refusal([row(ch, ch)]), name).toBe(hidden(1, "label"));
      expect(await refusal([row(ch, "7 pm")]), name).toBe(hidden(1, "label"));
      expect(await refusal([ROWS[0], row("Age", ch)]), name).toBe(hidden(2, "value"));
      // In text.
      expect(await refusal([row(`Do${ch}ors`, "7 pm")]), name).toBe(hidden(1, "label"));
      expect(await refusal([ROWS[0], row("Age", `18${ch}+`)]), name).toBe(hidden(2, "value"));
    }
    // The rest of Default_Ignorable_Code_Point: U+1160, the combining grapheme joiner, a Khmer inherent vowel,
    // the other variation selectors (VS1, VS15, a supplementary one), the unassigned U+2065, U+FFF0 and U+E0000.
    for (const ch of ["\u1160", "\u034F", "\u17B4", "\u180F", "\uFE00", "\uFE0E", "\u{E0100}", "\u2065", "\uFFF0", "\u{E0000}"]) {
      expect(await refusal([row("Entry", `7${ch} pm`)]), JSON.stringify(ch)).toBe(hidden(1, "value"));
    }
    // VS16 (U+FE0F) only right after an emoji: alone, after a letter or a space, doubled, or after a flag's tags, refused.
    const flag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    for (const text of ["\uFE0F", "Entry\uFE0F", "Doors \uFE0F", "\u2764\uFE0F\uFE0F", `${flag}\uFE0F`, "a\u200D\uFE0F"]) {
      expect(await refusal([row("Entry", text)]), JSON.stringify(text)).toBe(hidden(1, "value"));
    }
    // A lone tag character, or a flag's tags without their black flag: refused.
    expect(await refusal([row("Entry", "\u{E0067}\u{E0062}\u{E007F}")])).toBe(hidden(1, "value"));

    // Emoji with VS16 (a red heart, a keycap, a ZWJ sequence) and a subdivision flag (Scotland): fine, stored as sent.
    const emoji = [
      row("\u2764\uFE0F Extras", "Free water \u2764\uFE0F"),
      row("Doors", "1\uFE0F\u20E3 at the side"),
      row("Night", "\u{1F3F3}\uFE0F\u200D\u{1F308} Pride"),
      row(`${flag} Crew`, `Scotland ${flag}`),
    ];
    expect(await accepted(emoji)).toEqual(emoji);
  });

  it("numbers its errors by the row's place in the list sent, blank rows included (as the editor shows them)", async () => {
    // The API's own checks (stacked marks; a filler) on the second row, after a blank first: "Row 2", not "Row 1".
    expect(await refusal([row("", ""), row(`Z${"\u0301".repeat(6)}`, "x")])).toBe(
      "Row 2's label can't stack accents or other marks on one character.",
    );
    expect(await refusal([row(" ", ""), ROWS[0], row("", ""), row("Age", "\u3164")])).toBe(
      "Row 4's value can't contain control, invisible or text-direction characters.",
    );
  });

  it("refuses anything that isn't a list of label and value text", async () => {
    for (const value of ["Doors at 7", 42, true, { label: "Entry", value: "7 pm" }]) {
      expect(await refusal(value)).toBe("Send the rows as a list of labels and values, or null.");
    }
    for (const item of ["Entry: 7 pm", null, ["Entry", "7 pm"], { label: 1, value: "7 pm" }, { label: "Entry", value: ["7 pm"] }]) {
      expect(await refusal([ROWS[0], item])).toBe("Row 2 must be a label and a value, as text.");
    }
  });

  it("keeps HTML-like text as the characters typed (plain text, never markup)", async () => {
    const html = row("<b>Doors</b>", `7 & the bar's "cash only" <script>alert(1)</script>`);
    expect(await accepted([html])).toEqual([html]);
  });

  it("reports its error with the other fields' at once", async () => {
    const res = await create({ title: "", beforeYouGo: [row("Age", "")] });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["beforeYouGo", "title"]);
  });

  it("an edit keeps the rows when the key isn't sent, replaces them, and clears them with null or []", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const body = eventInput({ title: "Renamed" });
    expect(body).not.toHaveProperty("beforeYouGo");
    const kept = await patch(event.eventId, { title: "Renamed" });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ title: "Renamed", beforeYouGo: ROWS });
    expect(await stored(event.eventId)).toEqual(ROWS);

    const replaced = await patch(event.eventId, { beforeYouGo: [row("Entry", "Doors at 6")] });
    expect(replaced.body.beforeYouGo).toEqual([row("Entry", "Doors at 6")]);

    const cleared = await patch(event.eventId, { beforeYouGo: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("beforeYouGo");
    expect(await stored(event.eventId)).toBeNull();

    await patch(event.eventId, { beforeYouGo: ROWS });
    const emptied = await patch(event.eventId, { beforeYouGo: [] });
    expect(emptied.status).toBe(200);
    expect(emptied.body).not.toHaveProperty("beforeYouGo");
    expect(await stored(event.eventId)).toBeNull();
  });

  it("an invalid edit writes nothing", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const res = await patch(event.eventId, { title: "Changed", beforeYouGo: [row("Map", "venue.com")] });
    expect(res.status).toBe(400);
    const [r] = await api.db.query<{ title: string }>(`select title from public.events where id = $1`, [event.eventId]);
    expect(r.title).toBe("Neon Static");
    expect(await stored(event.eventId)).toEqual(ROWS);
  });

  it("follows the edit rules of the other fields: not while in review or published", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    await submit(event.eventId);
    const res = await patch(event.eventId, { beforeYouGo: [row("Entry", "Changed in review")] });
    expect(res.status).toBe(409);
    expect(await stored(event.eventId)).toEqual(ROWS);
  });
});

describe("the editor's helpers (lib/before-you-go.ts)", () => {
  it("normaliseBeforeYouGo cleans and drops as the API stores", () => {
    expect(normaliseBeforeYouGo([row(" Entry ", " 7:30  pm "), row("", " ")])).toEqual([row("Entry", "7:30 pm")]);
    for (const none of [null, undefined, [], [row(" ", "")]]) expect(normaliseBeforeYouGo(none)).toBeNull();
  });

  it("validateBeforeYouGo returns each row's errors at its index, the list's, and the API's message", () => {
    expect(validateBeforeYouGo(ROWS)).toBeNull();
    expect(validateBeforeYouGo([])).toBeNull();
    expect(validateBeforeYouGo([row("", "")])).toBeNull();

    expect(validateBeforeYouGo([ROWS[0], row("Age", ""), row("x".repeat(21), "See venue.com")])).toEqual({
      rows: [
        null,
        { value: "Row 2 needs a label and a value." },
        { label: "Row 3's label must be 20 characters or fewer.", value: "Row 3's value can't include links or web addresses." },
      ],
      list: null,
      message: "Row 2 needs a label and a value.",
    });
    const six = Array.from({ length: 6 }, (_, i) => row(`L${i}`, `V${i}`));
    expect(validateBeforeYouGo(six)).toEqual({ rows: six.map(() => null), list: BEFORE_YOU_GO_TOO_MANY, message: BEFORE_YOU_GO_TOO_MANY });
    // A half-filled row counts towards the five; the list's error comes before any row's.
    expect(validateBeforeYouGo([...six.slice(0, 4), row("", "Orphan")])?.message).toBe("Row 5 needs a label and a value.");
    const sixth = validateBeforeYouGo([...six.slice(0, 5), row("", "Orphan")]);
    expect(sixth?.message).toBe(BEFORE_YOU_GO_TOO_MANY);
    expect(sixth?.rows[5]).toEqual({ label: "Row 6 needs a label and a value." });
  });

  it("suggests the reference labels", () => {
    expect(BEFORE_YOU_GO_SUGGESTED_LABELS).toEqual(["Entry", "Age", "Extras"]);
  });
});

describe("who can set and read it", () => {
  it("401 signed out, 403 for an account that isn't an approved organiser", async () => {
    const anon = await api.call(createEventDraft, { body: eventInput({ beforeYouGo: ROWS }) });
    expect(anon.status).toBe(401);
    const member = await api.signUp();
    const res = await create({ beforeYouGo: ROWS }, member.token);
    expect(res.status).toBe(403);
  });

  it("another organiser's event is a 404 to read and to edit, and stays as it was", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });

    const read = await api.call(getMyEvent, { token: other.token, params: { eventId: event.eventId } });
    expect(read.status).toBe(404);
    expect(read.body).not.toHaveProperty("beforeYouGo");

    const edit = await patch(event.eventId, { beforeYouGo: [row("Hijacked", "yes")] }, other.token);
    expect(edit.status).toBe(404);
    const clear = await patch(event.eventId, { beforeYouGo: null }, other.token);
    expect(clear.status).toBe(404);
    expect(await stored(event.eventId)).toEqual(ROWS);
  });

  it("is public on a published event's page and in the feed, the same in both", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: ROWS });
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.status).toBe(200);
    expect(page.body.beforeYouGo).toEqual(ROWS);
    const list = await api.call(listPublicEvents);
    const item = list.body.items.find((e: { slug: string }) => e.slug === event.slug);
    expect(item).toEqual(withoutHostCard(page.body));

    const plain = await publishedEvent(api, organiser, admin, { title: "Plain" });
    const plainPage = await api.call(getPublicEventBySlug, { params: { slug: plain.slug } });
    expect(plainPage.body).not.toHaveProperty("beforeYouGo");
  });

  it("a draft's rows aren't public", async () => {
    const draft = await draftEvent(api, organiser, { beforeYouGo: [row("Secret", "Phone-free night")] });
    const page = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(page.status).toBe(404);
    const list = await api.call(listPublicEvents);
    expect(JSON.stringify(list.body)).not.toContain("Phone-free");
  });

  it("admins see them in the review queue and on the event", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    await submit(event.eventId);
    const queue = await api.call(adminListEvents, { token: admin.token, query: { status: "pending_review" } });
    expect(queue.status).toBe(200);
    expect(queue.body.items.find((e: { eventId: string }) => e.eventId === event.eventId).beforeYouGo).toEqual(ROWS);
    const one = await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } });
    expect(one.body.beforeYouGo).toEqual(ROWS);
  });
});

describe("an admin's create and edit", () => {
  const editBody = (event: AdminEventRecord, overrides: Record<string, unknown> = {}) => ({
    ...eventInput(),
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode,
    expectedUpdatedAt: event.updatedAt,
    ...overrides,
  });
  const adminEdit = (eventId: string, body: unknown) =>
    api.call(adminUpdateEvent, { token: admin.token, params: { eventId }, body, method: "PATCH" });
  const NEW_ROWS = [row("Entry", "Doors at 6 pm")];

  it("creates with rows, edits them (logged with the old and new arrays), keeps them unsent, and clears them", async () => {
    const created = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ beforeYouGo: ROWS }), organiserId: organiser.organiserId },
    });
    expect(created.status).toBe(201);
    const event = created.body as AdminEventRecord;
    expect(event.beforeYouGo).toEqual(ROWS);

    const edited = await adminEdit(event.eventId, editBody(event, { beforeYouGo: NEW_ROWS }));
    expect(edited.status).toBe(200);
    expect(edited.body.beforeYouGo).toEqual(NEW_ROWS);
    expect(edited.body.moderationLog.at(-1)).toMatchObject({
      action: "edited",
      changes: { beforeYouGo: { old: ROWS, new: NEW_ROWS } },
    });

    // Not sent: kept, and nothing else changed, so nothing is written or logged.
    const logLength = edited.body.moderationLog.length;
    const unchanged = await adminEdit(event.eventId, editBody(edited.body));
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.beforeYouGo).toEqual(NEW_ROWS);
    expect(unchanged.body.moderationLog).toHaveLength(logLength);
    // The same rows sent again (after cleaning): no change either.
    const same = await adminEdit(event.eventId, editBody(unchanged.body, { beforeYouGo: [row(" Entry ", "Doors  at 6 pm")] }));
    expect(same.body.moderationLog).toHaveLength(logLength);

    const cleared = await adminEdit(event.eventId, editBody(same.body, { beforeYouGo: [] }));
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("beforeYouGo");
    expect(cleared.body.moderationLog.at(-1).changes).toEqual({ beforeYouGo: { old: NEW_ROWS, new: null } });
    expect(await stored(event.eventId)).toBeNull();

    const restored = await adminEdit(event.eventId, editBody(cleared.body, { beforeYouGo: ROWS }));
    expect(restored.body.moderationLog.at(-1).changes).toEqual({ beforeYouGo: { old: null, new: ROWS } });
  });

  it("an admin can change a published event's rows; the organiser sees the change as Sheltüh's", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: ROWS });
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body as AdminEventRecord;
    const res = await adminEdit(event.eventId, editBody(current, { beforeYouGo: [row("Entry", "Doors moved to 8 pm")] }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.body.beforeYouGo).toEqual([row("Entry", "Doors moved to 8 pm")]);
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.moderationLog.at(-1)).toMatchObject({
      action: "edited",
      changes: { beforeYouGo: { old: ROWS, new: [row("Entry", "Doors moved to 8 pm")] } },
    });
  });

  it("validates like the organiser's form", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ beforeYouGo: [row("Map", "venue.com")] }), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ beforeYouGo: "Row 1's value can't include links or web addresses." });
  });

  it("isn't for a signed-in organiser", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const res = await api.call(adminUpdateEvent, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: { ...eventInput({ beforeYouGo: null }), expectedUpdatedAt: event.updatedAt, ticketingMode: "sheltuh" },
      method: "PATCH",
    });
    expect(res.status).toBe(403);
    expect(await stored(event.eventId)).toEqual(ROWS);
  });
});

describe("the emails' and the ticket page's data", () => {
  const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 }];

  const cron = () =>
    api.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
  const ticketPage = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

  /** A free order booked by a member with their own verified email: issued straight away, its ticket email queued. */
  async function memberFreeOrder(eventId: string) {
    const member = await api.signUp({ email: `member-${crypto.randomUUID().slice(0, 8)}@example.com` });
    const res = await api.call(createCheckout, {
      token: member.token,
      params: { eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: member.email },
    });
    expect(res.status).toBe(201);
    return new URL(res.body.url).searchParams.get("session_id") as string;
  }

  it("the ticket email's event and the ticket page carry the rows", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: ROWS });
    const orderId = await memberFreeOrder(event.eventId);
    await api.runDeferred();
    await cron();
    const calls = vi.mocked(buildTicketEmail).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)![1].beforeYouGo).toEqual(ROWS);

    const page = await ticketPage(orderId);
    expect(page).toMatchObject({ status: "paid", eventListed: true, beforeYouGo: ROWS });
  });

  it("the ticket page leaves them out once the event isn't published, and when there are none", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: ROWS });
    const orderId = await memberFreeOrder(event.eventId);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    const page = await ticketPage(orderId);
    expect(page.eventListed).toBe(false);
    expect(page).not.toHaveProperty("beforeYouGo");

    const plain = await publishedEvent(api, organiser, admin, { title: "Plain", ticketTypes: FREE });
    expect(await ticketPage(await memberFreeOrder(plain.eventId))).not.toHaveProperty("beforeYouGo");
  });

  it("the ticket page leaves them out of an order that isn't paid", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: ROWS });
    const orderId = await insertOrder(api, event, "refunded@example.com", "refunded");
    const page = await ticketPage(orderId);
    expect(page.status).toBe("refunded");
    expect(page).not.toHaveProperty("beforeYouGo");
  });

  it("the free-ticket confirmation's event carries the rows", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: ROWS });
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    expect(res.status).toBe(202);
    const calls = vi.mocked(buildFreeConfirmationEmail).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as EventRecord).beforeYouGo).toEqual(ROWS);
  });

  it("the reminder's event carries the rows", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: ROWS });
    await api.db.query(`delete from private.email_outbox where kind <> 'event_reminder'`);
    const orderId = await insertOrder(api, event, "goer@example.com", "paid");
    await api.db.query(`update public.orders set created_at = now() - interval '1 day' where id = $1`, [orderId]);
    await api.db.query(
      `update public.events set starts_at = now() + interval '20 hours', ends_at = now() + interval '23 hours' where id = $1`,
      [event.eventId],
    );
    const [{ n }] = await api.db.query<{ n: number }>(`select private.queue_event_reminders(100, now(), 0) as n`);
    expect(n).toBe(1);
    await cron();
    const calls = vi.mocked(buildEventReminderEmail).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].event.beforeYouGo).toEqual(ROWS);
  });
});

describe("the database", () => {
  /** Writes `json` (jsonb text, or SQL null) straight to a fresh draft's column. */
  async function setRows(json: string | null) {
    const event = await draftEvent(api, organiser, { title: `DB ${crypto.randomUUID().slice(0, 6)}` });
    return api.db.query(`update public.events set before_you_go = $2::text::jsonb where id = $1`, [event.eventId, json]);
  }
  const rows = (...items: unknown[]) => JSON.stringify(items);

  it("holds the shape and limits whatever the code sends", async () => {
    const bad = [
      "null",
      "[]",
      "{}",
      '"Doors at 7"',
      "42",
      rows(...Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, value: "v" }))),
      rows("Entry"),
      rows(null),
      rows(["Entry", "7 pm"]),
      rows({}),
      rows({ label: "Entry" }),
      rows({ value: "7 pm" }),
      rows({ label: "Entry", value: "7 pm", extra: "x" }),
      rows({ label: "Entry", val: "7 pm" }),
      rows({ label: 1, value: "7 pm" }),
      rows({ label: "Entry", value: null }),
      rows({ label: "", value: "7 pm" }),
      rows({ label: "Entry", value: "" }),
      rows({ label: "x".repeat(21), value: "v" }),
      rows({ label: "l", value: "x".repeat(81) }),
      rows({ label: " Entry", value: "v" }),
      rows({ label: "Entry ", value: "v" }),
      rows({ label: "En  try", value: "v" }),
      rows({ label: "Entry", value: "7 pm\nlate" }),
      rows({ label: "Entry", value: "7 pm\rlate" }),
      rows({ label: "Entry", value: "7\tpm" }),
      rows({ label: "Entry", value: "7\u0001pm" }),
      rows({ label: "Entry", value: "7\u007Fpm" }),
      rows({ label: "Entry", value: "7\u0085pm" }),
      rows({ label: "Entry", value: "7\u009Fpm" }),
      rows({ label: "Entry", value: "7 pm" }),
      rows({ label: "Entry", value: "7 pm" }),
      rows({ label: "En‮try", value: "v" }),
      rows({ label: "En​try", value: "v" }),
      rows({ label: "En﻿try", value: "v" }),
      rows({ label: "Entry", value: "ok" }, { label: "Age", value: "18+\n" }),
    ];
    for (const json of bad) {
      await expect(setRows(json), json).rejects.toThrow(/events_before_you_go_check/);
    }
    const good = [
      null,
      JSON.stringify(ROWS),
      rows(...Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, value: "v" }))),
      rows({ label: "x".repeat(20), value: "y".repeat(80) }),
      rows({ label: "🎟".repeat(20), value: "🎟".repeat(80) }),
      rows({ label: "Crew", value: "👩‍🎤 on stage" }),
    ];
    for (const json of good) {
      await expect(setRows(json), String(json)).resolves.toBeDefined();
    }
  });

  it("refuses the other default-ignorable characters, and keeps emoji with VS16 and subdivision flags", async () => {
    const flag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    const bad: string[] = [];
    for (const ch of ["\u3164", "\u115F", "\uFFA0", "\u180B"]) {
      bad.push(
        rows({ label: ch, value: ch }),
        rows({ label: ch, value: "7 pm" }),
        rows({ label: "Entry", value: ch }),
        rows({ label: `Do${ch}ors`, value: "7 pm" }),
        rows({ label: "Entry", value: `7${ch} pm` }),
      );
    }
    for (const value of [
      "7\u1160pm", "7\u034Fpm", "7\u17B5pm", "7\u180Fpm", "7\uFE00pm", "7\uFE0Epm", "7\u{E0100}pm", "7\u2065pm",
      "7\uFFF0pm", "7\u0600pm", "7\uFFF9pm", "7\u{13430}pm", "7\u{E0000}pm", "7\u{E0FFF}pm",
      // Tag characters outside a flag sequence.
      "7\u{E0001}pm", "7\u{E0067}\u{E0062}\u{E007F}pm",
      // VS16 first, after a letter or a space, doubled, or after a flag's tags.
      "\uFE0F", "Entry\uFE0F", "Doors \uFE0F", "\u2764\uFE0F\uFE0F", `${flag}\uFE0F`, "a\u200D\uFE0F",
    ]) {
      bad.push(rows({ label: "Entry", value }));
    }
    for (const json of bad) {
      await expect(setRows(json), json).rejects.toThrow(/events_before_you_go_check/);
    }
    const good = [
      rows({ label: "\u2764\uFE0F Extras", value: "Free water \u2764\uFE0F" }),
      rows({ label: "Doors", value: "1\uFE0F\u20E3 #\uFE0F\u20E3 \u00A9\uFE0F" }),
      rows({ label: "Night", value: "\u{1F3F3}\uFE0F\u200D\u{1F308} Pride" }),
      rows({ label: `${flag} Crew`, value: `Scotland ${flag} and England \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}` }),
    ];
    for (const json of good) {
      await expect(setRows(json), json).resolves.toBeDefined();
    }
  });

  it("never refuses what the API stores, and refuses every invisible character the API refuses", async () => {
    // Every control, format and default-ignorable code point (NUL aside: no text holds it) between two letters,
    // and VS16 after every emoji.
    const invisible = /^(?:\p{Cc}|\p{Cf}|\p{Default_Ignorable_Code_Point}|\u2028|\u2029)$/u;
    const emoji = /^\p{Emoji}$/u;
    const texts: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (invisible.test(ch)) texts.push(`a${ch}b`);
      if (emoji.test(ch)) texts.push(`${ch}\uFE0F`);
    }
    // What the API stores of each (null: refused).
    const storedAs = texts.map((text) => (validateBeforeYouGo([row("Entry", text)]) ? null : normaliseBeforeYouGo([row("Entry", text)])![0].value));
    const checked = texts.map((text, i) => storedAs[i] ?? text);
    const results = await api.db.query<{ i: number; ok: boolean }>(
      `select (t.ord - 1)::integer as i, private.before_you_go_text_ok(t.text, 80) as ok
         from jsonb_array_elements_text($1::text::jsonb) with ordinality as t (text, ord)`,
      [JSON.stringify(checked)],
    );
    expect(results).toHaveLength(texts.length);
    const disagree = results
      .filter(({ i, ok }) => ok !== (storedAs[i] !== null))
      .map(({ i }) => `${Array.from(texts[i], (c) => c.codePointAt(0)!.toString(16)).join(" ")}: API ${storedAs[i] === null ? "refuses" : "stores"}`);
    expect(disagree).toEqual([]);
  });

  it("the write functions store JSON null and [] as SQL null, never jsonb 'null'", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const fields = (extra: Record<string, unknown>) =>
      JSON.stringify({ ...eventInput(), startsAt: event.startsAt, endsAt: event.endsAt, ticketingMode: "sheltuh", ...extra });
    for (const clear of [null, []]) {
      await api.db.query(`update public.events set before_you_go = $2::text::jsonb where id = $1`, [event.eventId, JSON.stringify(ROWS)]);
      const [r] = await api.db.query<{ result: string }>(
        `select private.edit_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as result`,
        [event.eventId, organiser.organiserId, fields({ beforeYouGo: clear }), JSON.stringify(event.ticketTypes)],
      );
      expect(r.result).toBe("updated");
      const [{ isNull }] = await api.db.query<{ isNull: boolean }>(
        `select before_you_go is null as "isNull" from public.events where id = $1`,
        [event.eventId],
      );
      expect(isNull, JSON.stringify(clear)).toBe(true);
    }
    const [{ id }] = await api.db.query<{ id: string }>(
      `select private.create_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as id`,
      [organiser.organiserId, "db-null-rows", fields({ beforeYouGo: null }), JSON.stringify(event.ticketTypes)],
    );
    expect(await stored(id)).toBeNull();
  });

  it("a caller from before the field (no key) creates none, and its edits keep the stored rows", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: ROWS });
    const fields = { ...eventInput(), startsAt: event.startsAt, endsAt: event.endsAt, ticketingMode: "sheltuh" };
    expect(fields).not.toHaveProperty("beforeYouGo");

    const [r] = await api.db.query<{ result: string }>(
      `select private.edit_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as result`,
      [event.eventId, organiser.organiserId, JSON.stringify(fields), JSON.stringify(event.ticketTypes)],
    );
    expect(r.result).toBe("updated");
    expect(await stored(event.eventId)).toEqual(ROWS);

    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body as AdminEventRecord;
    const [a] = await api.db.query<{ result: string }>(
      `select private.admin_edit_event($1, $2, $3::timestamptz, $4::text::jsonb, $5::text::jsonb, false, null) as result`,
      [event.eventId, admin.userId, current.updatedAt, JSON.stringify({ ...fields, title: "Admin renamed" }), JSON.stringify(current.ticketTypes)],
    );
    expect(a.result).toBe("updated");
    expect(await stored(event.eventId)).toEqual(ROWS);
    const log = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body.moderationLog;
    expect(log.at(-1).changes).not.toHaveProperty("beforeYouGo");

    const [{ id }] = await api.db.query<{ id: string }>(
      `select private.create_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as id`,
      [organiser.organiserId, "old-app-create", JSON.stringify(fields), JSON.stringify(event.ticketTypes)],
    );
    expect(await stored(id)).toBeNull();
  });

  it("the helpers aren't callable by clients", async () => {
    const [r] = await api.db.query<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'private.before_you_go_ok(jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'private.before_you_go_of(jsonb)', 'execute') as authed`,
    );
    expect(r).toEqual({ anon: false, authed: false });
  });
});
