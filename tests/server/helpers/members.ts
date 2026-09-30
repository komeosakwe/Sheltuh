import { putMyGoing } from "@/lib/server/handlers/going";
import type { TestApi } from "./api";
import { insertOrder } from "./fixtures";

export type Member = { token: string; userId: string; email: string; displayName: string };
export type GoingMember = Member & { attendeeId: string };

/** A signed-up user with a profile (unless `profile: false`). Created directly: putMyProfile refuses unverified callers. */
export async function member(
  api: TestApi,
  options: { email?: string; emailVerified?: boolean; displayName?: string; profile?: boolean } = {},
): Promise<Member> {
  const user = await api.signUp({ email: options.email, emailVerified: options.emailVerified });
  const displayName = options.displayName ?? `Member ${user.userId.slice(0, 6)}`;
  if (options.profile !== false) {
    await api.db.query(`insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, $2, now())`, [
      user.userId,
      displayName,
    ]);
  }
  return { ...user, displayName };
}

/** The opaque attendeeId of `m` on `eventId` (what the Who's Going list shows). */
export async function attendeeIdOf(api: TestApi, m: { userId: string }, eventId: string): Promise<string> {
  const [row] = await api.db.query<{ id: string }>(
    `select id from public.event_attendees where event_id = $1 and user_id = $2`,
    [eventId, m.userId],
  );
  if (!row) throw new Error("not going");
  return row.id;
}

/** Makes an existing member a ticket holder for `event` and opts them in through the API. */
export async function optIn(api: TestApi, m: Member, event: { eventId: string; organiserId: string }) {
  await insertOrder(api, event, m.email);
  const res = await api.call(putMyGoing, { token: m.token, params: { eventId: event.eventId }, method: "PUT" });
  if (res.status !== 200) throw new Error(`putMyGoing failed: ${res.status} ${JSON.stringify(res.body)}`);
  return attendeeIdOf(api, m, event.eventId);
}

/** A member with a paid order for `event`, opted in to its Who's Going. */
export async function goingMember(
  api: TestApi,
  event: { eventId: string; organiserId: string },
  options: { displayName?: string; email?: string } = {},
): Promise<GoingMember> {
  const m = await member(api, options);
  return { ...m, attendeeId: await optIn(api, m, event) };
}

export async function suspend(api: TestApi, m: { userId: string }) {
  await api.db.query(`insert into private.social_suspensions (user_id, reason) values ($1, 'test')`, [m.userId]);
}
