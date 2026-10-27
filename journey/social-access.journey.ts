import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ticketQrPayload } from "@/lib/ticket-code";
import { buyTickets, organiserWithPayouts, publishedEvent, scan, type Organiser } from "./harness/flows";
import { journeyEnabled, startJourney, type Journey, type User } from "./harness";

/*
 * Who's Going between two real ticket holders, and access boundaries, over
 * HTTP with bearer tokens checked by the production verifyAccessToken
 * (supabase-js against the local auth stub) on every request.
 */

describe.skipIf(!journeyEnabled)("Who's Going and access boundaries (journey harness)", () => {
  let j: Journey;
  let admin: User;
  let organiser: Organiser;

  beforeAll(async () => {
    j = await startJourney();
    admin = await j.signUp({ admin: true });
    organiser = await organiserWithPayouts(j, admin);
  });

  afterAll(async () => {
    await j?.stop();
  });

  it("3. two ticket holders join Who's Going and message; a report is recorded; a block stops messaging both ways", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey Three" });
    const ada = await j.signUp({ email: "ada.social@journey.test" });
    const grace = await j.signUp({ email: "grace.social@journey.test" });
    // Both buy with their account's email (the ticket is what makes them eligible).
    await buyTickets(j, event.eventId, ada.email);
    await buyTickets(j, event.eventId, grace.email);

    for (const [member, displayName] of [
      [ada, "Ada"],
      [grace, "Grace"],
    ] as const) {
      const profile = await j.request("PUT", "/api/profiles/me", { token: member.token, body: { displayName, adultConfirmed: true } });
      expect(profile.status).toBe(200);
      const going = await j.request("PUT", `/api/events/${event.eventId}/going/me`, { token: member.token });
      expect(going.status).toBe(200);
    }
    // Someone without a ticket can't join.
    const stranger = await j.signUp();
    await j.request("PUT", "/api/profiles/me", { token: stranger.token, body: { displayName: "Stranger", adultConfirmed: true } });
    expect((await j.request("PUT", `/api/events/${event.eventId}/going/me`, { token: stranger.token })).status).toBe(403);

    const list = await j.request("GET", `/api/events/${event.eventId}/going/attendees`, { token: ada.token });
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    const names = (list.body.items as { displayName: string; isYou: boolean }[]).map((a) => [a.displayName, a.isYou]);
    expect(names.sort()).toEqual([
      ["Ada", true],
      ["Grace", false],
    ]);
    const graceId = (list.body.items as { attendeeId: string; isYou: boolean }[]).find((a) => !a.isYou)!.attendeeId;

    // Ada asks; Grace replies (accepting); they talk.
    const started = await j.request("POST", "/api/conversations", { token: ada.token, body: { attendeeId: graceId, body: "Hi! Going alone too?" } });
    expect(started.status).toBe(201);
    const conversationId = started.body.conversationId as string;
    const messagesPath = `/api/conversations/${conversationId}/messages`;
    const inbox = await j.request("GET", "/api/conversations", { token: grace.token });
    expect(inbox.body.items).toMatchObject([{ conversationId, otherDisplayName: "Ada", status: "request_received" }]);
    expect((await j.request("POST", messagesPath, { token: grace.token, body: { body: "Yes! See you at the bar." } })).status).toBe(201);
    const pushy = await j.request("POST", messagesPath, { token: ada.token, body: { body: "Great, what's your number?" } });
    expect(pushy.status).toBe(201);
    const thread = await j.request("GET", messagesPath, { token: grace.token });
    expect(thread.status).toBe(200);
    expect((thread.body.items as { body: string }[]).map((m) => m.body)).toEqual([
      "Hi! Going alone too?",
      "Yes! See you at the bar.",
      "Great, what's your number?",
    ]);

    // Grace reports Ada's message, then blocks her.
    const report = await j.request("POST", "/api/reports", {
      token: grace.token,
      body: { conversationId, messageId: pushy.body.messageId, reason: "harassment", details: "Asked for my number." },
    });
    expect(report.status).toBe(201);
    const block = await j.request("POST", "/api/blocks", { token: grace.token, body: { conversationId } });
    expect(block.status).toBe(201);
    expect(block.body.displayName).toBe("Ada");

    // Messaging is refused both ways, and neither can start again (it looks like an unknown member).
    expect((await j.request("POST", messagesPath, { token: ada.token, body: { body: "Hello?" } })).status).toBe(404);
    expect((await j.request("POST", messagesPath, { token: grace.token, body: { body: "Bye" } })).status).toBe(404);
    expect((await j.request("POST", "/api/conversations", { token: ada.token, body: { attendeeId: graceId, body: "Again" } })).status).toBe(404);
    expect((await j.request("GET", "/api/conversations", { token: ada.token })).body.items).toEqual([]);

    // The report is waiting for an admin, with the reported message kept; not visible to members.
    expect((await j.request("GET", "/api/admin/reports", { token: grace.token })).status).toBe(403);
    const reports = await j.request("GET", "/api/admin/reports?status=open", { token: admin.token });
    expect(reports.status).toBe(200);
    expect(reports.body.items).toMatchObject([
      { reportId: report.body.reportId, status: "open", reason: "harassment", reportedDisplayName: "Ada", messageBody: "Great, what's your number?" },
    ]);
  });

  it("4. another organiser gets 404 for this event's dashboard, data and door; members and signed-out callers can't scan", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey Four" });
    const { codes } = await buyTickets(j, event.eventId, "access.buyer@journey.test");
    // With payouts: a paid event can't be submitted without them (20261109000000_paid_events_need_payouts.sql).
    const rival = await organiserWithPayouts(j, admin);
    const rivalEvent = await publishedEvent(j, rival, admin, { title: "Rival night" });
    const base = `/api/organisers/me/events/${event.eventId}`;

    // The owner sees it all.
    expect((await j.request("GET", base, { token: organiser.token })).status).toBe(200);
    expect((await j.request("GET", `${base}/analytics`, { token: organiser.token })).status).toBe(200);

    // Another organiser: indistinguishable from a missing event.
    for (const [method, path, body] of [
      ["GET", base, undefined],
      ["GET", `${base}/analytics`, undefined],
      ["GET", `${base}/analytics.csv`, undefined],
      ["GET", `${base}/check-ins`, undefined],
      ["GET", `${base}/tracking-links`, undefined],
      ["POST", `${base}/check-ins`, { code: codes[0], requestId: crypto.randomUUID() }],
      ["PATCH", `/api/events/${event.eventId}`, { title: "Taken over" }],
    ] as const) {
      const res = await j.request(method, path, { token: rival.token, body });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    const rivalList = await j.request("GET", "/api/organisers/me/events", { token: rival.token });
    expect(rivalList.status).toBe(200);
    expect(JSON.stringify(rivalList.body)).not.toContain(event.eventId);
    // At their own door, this event's ticket is just an invalid code (no hint whose it is).
    const foreign = await scan(j, rival, rivalEvent.eventId, ticketQrPayload(codes[0]));
    expect(foreign).toMatchObject({ status: 200, body: { outcome: "invalid" } });
    expect(Object.keys(foreign.body)).toEqual(["outcome"]);

    // Not staff at all: a member is refused (403), no token or an expired one is a 401.
    const member = await j.signUp();
    expect((await scan(j, member, event.eventId, codes[0])).status).toBe(403);
    expect((await scan(j, {}, event.eventId, codes[0])).status).toBe(401);
    const expiring = await j.signUp();
    j.auth.revoke(expiring.token);
    expect((await scan(j, expiring, event.eventId, codes[0])).status).toBe(401);
    // Organisers aren't admins.
    expect((await j.request("GET", "/api/admin/payment-exceptions", { token: organiser.token })).status).toBe(403);

    // None of that checked the ticket in: the owner's scan is still its first admission.
    expect((await scan(j, organiser, event.eventId, codes[0])).body.outcome).toBe("admitted");
    const summary = await j.request("GET", `${base}/check-ins`, { token: organiser.token });
    expect(summary.body.recent).toHaveLength(1);
  });
});
