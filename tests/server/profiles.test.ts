import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGoingSummary, putMyGoing } from "@/lib/server/handlers/going";
import { deleteMyProfile, getMyProfile, putMyProfile } from "@/lib/server/handlers/profiles";
import { parseDisplayName } from "@/lib/server/profile-input";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
});

const putProfile = (token: string | undefined, body: unknown) =>
  api.call(putMyProfile, { token, body, method: "PUT" });
const getProfile = (token?: string) => api.call(getMyProfile, { token });
const deleteProfile = (token?: string) => api.call(deleteMyProfile, { token, method: "DELETE" });

async function profileRow(userId: string) {
  const [row] = await api.db.query<{ display_name: string; adult_confirmed_at: Date }>(
    `select display_name, adult_confirmed_at from public.profiles where user_id = $1`,
    [userId],
  );
  return row;
}

describe("profile lifecycle", () => {
  it("requires sign-in", async () => {
    expect((await getProfile()).status).toBe(401);
    expect((await putProfile(undefined, { displayName: "Ada", adultConfirmed: true })).status).toBe(401);
    expect((await deleteProfile()).status).toBe(401);
  });

  it("is a 404 until created", async () => {
    const user = await api.signUp();
    expect((await getProfile(user.token)).status).toBe(404);
  });

  it("creating one needs the adult confirmation; renaming doesn't, and keeps it", async () => {
    const user = await api.signUp();

    for (const adultConfirmed of [undefined, false]) {
      const res = await putProfile(user.token, { displayName: "Ada", adultConfirmed });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["adultConfirmed"]);
    }
    expect(await profileRow(user.userId)).toBeUndefined();

    const created = await putProfile(user.token, { displayName: "Ada", adultConfirmed: true });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({
      displayName: "Ada",
      suspended: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const confirmedAt = (await profileRow(user.userId)).adult_confirmed_at;
    expect(confirmedAt).toBeTruthy();

    const renamed = await putProfile(user.token, { displayName: "Ada L." });
    expect(renamed.status).toBe(200);
    expect(renamed.body.displayName).toBe("Ada L.");
    expect((await getProfile(user.token)).body.displayName).toBe("Ada L.");
    // Renaming with the confirmation again doesn't reset when it was given.
    await putProfile(user.token, { displayName: "Ada", adultConfirmed: true });
    expect(new Date((await profileRow(user.userId)).adult_confirmed_at).toISOString()).toBe(
      new Date(confirmedAt).toISOString(),
    );
  });

  it("rejects a non-boolean adultConfirmed", async () => {
    const user = await api.signUp();
    const res = await putProfile(user.token, { displayName: "Ada", adultConfirmed: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.adultConfirmed).toBeDefined();
  });

  it("needs a verified email to create or rename", async () => {
    const user = await api.signUp({ emailVerified: false });
    expect((await putProfile(user.token, { displayName: "Ada", adultConfirmed: true })).status).toBe(403);
    expect(await profileRow(user.userId)).toBeUndefined();
  });

  it("reports a suspension to its owner", async () => {
    const user = await api.signUp();
    await putProfile(user.token, { displayName: "Ada", adultConfirmed: true });
    await api.db.query(`update public.profiles set social_suspended_at = now() where user_id = $1`, [user.userId]);
    expect((await getProfile(user.token)).body.suspended).toBe(true);
  });

  it("only ever reads or writes the caller's own profile", async () => {
    const a = await api.signUp();
    const b = await api.signUp();
    await putProfile(a.token, { displayName: "Ada", adultConfirmed: true });
    await putProfile(b.token, { displayName: "Bea", adultConfirmed: true, userId: a.userId });
    expect((await getProfile(a.token)).body.displayName).toBe("Ada");
    expect((await getProfile(b.token)).body.displayName).toBe("Bea");

    await deleteProfile(b.token);
    expect((await getProfile(a.token)).status).toBe(200);
  });
});

describe("deleting a profile", () => {
  async function goingOn() {
    const admin = await signUpAdmin(api);
    const organiser = await approvedOrganiser(api, admin);
    const event = await publishedEvent(api, organiser, admin);
    const user = await api.signUp();
    await putProfile(user.token, { displayName: "Ada", adultConfirmed: true });
    await insertOrder(api, event, user.email);
    expect((await api.call(putMyGoing, { token: user.token, params: { eventId: event.eventId }, method: "PUT" })).status).toBe(
      200,
    );
    const count = async () =>
      (await api.call(getGoingSummary, { params: { eventId: event.eventId } })).body.count as number;
    expect(await count()).toBe(1);
    return { user, count };
  }

  it("removes every opt-in with it, and is idempotent", async () => {
    const { user, count } = await goingOn();
    // Deleting needs no verified email: withdrawing is never gated.
    const res = await deleteProfile(user.token);
    expect(res.status).toBe(204);
    expect((await deleteProfile(user.token)).status).toBe(204);

    expect((await getProfile(user.token)).status).toBe(404);
    expect(await count()).toBe(0);
    expect(await api.db.query(`select 1 from public.event_attendees`)).toEqual([]);
  });

  it("deleting the account cascades to the profile and its opt-ins", async () => {
    const { user, count } = await goingOn();
    await api.db.query(`delete from auth.users where id = $1`, [user.userId]);
    expect(await profileRow(user.userId)).toBeUndefined();
    expect(await count()).toBe(0);
  });
});

describe("display name validation", () => {
  const check = (value: unknown) => {
    const errors: Record<string, string> = {};
    const name = parseDisplayName(value, "displayName", errors);
    return { name, error: errors.displayName };
  };

  it.each([
    ["  Ada   Lovelace  ", "Ada Lovelace"],
    ["Zoë", "Zoë"],
    ["Björk", "Björk"],
    ["A.J. Smith", "A.J. Smith"],
    ["Mr. Me", "Mr. Me"],
    ["J. Cole", "J. Cole"],
    ["Ｂｅａ", "Ｂｅａ"],
    ["x".repeat(40), "x".repeat(40)],
    ["🎸".repeat(40), "🎸".repeat(40)],
    ["Badminton Ben", "Badminton Ben"],
  ])("accepts %j as %j", (input, expected) => {
    expect(check(input)).toEqual({ name: expected, error: undefined });
  });

  it.each([
    ["missing", undefined],
    ["non-string", 42],
    ["empty", ""],
    ["whitespace only", "   "],
    ["41 characters", "x".repeat(41)],
    ["newline", "Ada\nLovelace"],
    ["tab", "Ada\tLovelace"],
    ["zero-width space", "Ad​a"],
    ["zero-width joiner", "Ad‍a"],
    ["right-to-left override", "‮adA"],
    ["byte-order mark", "﻿Ada"],
    ["URL", "https://example.com"],
    ["scheme only", "ftp://x"],
    ["www", "www.example"],
    ["bare domain", "ada.com"],
    ["domain.au", "gigs.com.au"],
    ["obfuscated domain", "ada [dot] com"],
    ["email", "ada@example.com"],
    ["handle", "@ada"],
    ["fullwidth at", "ada＠example"],
    ["reserved: Sheltuh", "Sheltuh"],
    ["reserved: Sheltüh", "Sheltüh Team"],
    ["reserved: split", "Shel Tuh"],
    ["reserved: admin", "Admin"],
    ["reserved: support", "Sheltuh support"],
    ["reserved: support word", "Tech Support"],
    ["reserved: fullwidth", "ＡＤＭＩＮ"],
  ])("rejects %s", async (_label, input) => {
    const { error } = check(input);
    expect(error).toBeDefined();

    // And the endpoint turns it into a 400 field error without writing anything.
    const user = await api.signUp();
    const res = await putProfile(user.token, { displayName: input, adultConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.displayName).toBeDefined();
    expect(await profileRow(user.userId)).toBeUndefined();
  });

  it("the database enforces the length and required adult confirmation too", async () => {
    const user = await api.signUp();
    const insert = (name: string, confirmed: string | null) =>
      api.db.query(`insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, $2, $3)`, [
        user.userId,
        name,
        confirmed,
      ]);
    await expect(insert("x".repeat(41), new Date().toISOString())).rejects.toThrow();
    await expect(insert("", new Date().toISOString())).rejects.toThrow();
    await expect(insert(" padded ", new Date().toISOString())).rejects.toThrow();
    await expect(insert("Ada", null)).rejects.toThrow();
  });
});
