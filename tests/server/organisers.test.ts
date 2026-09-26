import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminApproveOrganiser, adminListOrganisers, adminRejectOrganiser } from "@/lib/server/handlers/admin";
import {
  applyAsOrganiser,
  connectOnboard,
  connectRefresh,
  getMyOrganiser,
  resubmitOrganiser,
} from "@/lib/server/handlers/organisers";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
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

describe("authentication", () => {
  it("rejects a request with no token, or an unrecognised one, with 401", async () => {
    expect((await api.call(getMyOrganiser)).status).toBe(401);
    expect((await api.call(getMyOrganiser, { token: "forged" })).status).toBe(401);
  });

  it("admin routes return 401 when signed out and 403 for a signed-in non-admin", async () => {
    expect((await api.call(adminListOrganisers)).status).toBe(401);
    const user = await api.signUp();
    const res = await api.call(adminListOrganisers, { token: user.token });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });
});

describe("organiser applications", () => {
  it("creates a pending application owned by the caller", async () => {
    const user = await api.signUp();
    expect((await api.call(getMyOrganiser, { token: user.token })).status).toBe(404);

    const res = await api.call(applyAsOrganiser, { token: user.token, body: application });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...application, status: "pending", ownerUserId: user.userId, payoutsEnabled: false });

    const mine = await api.call(getMyOrganiser, { token: user.token });
    expect(mine.body.organiserId).toBe(res.body.organiserId);
  });

  it("returns field errors for an invalid application", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, contactEmail: "nope", categories: ["karaoke"], websiteUrl: "ftp://x" },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["categories", "contactEmail", "websiteUrl"]);
  });

  it("allows only one application per account", async () => {
    const user = await api.signUp();
    await api.call(applyAsOrganiser, { token: user.token, body: application });
    const again = await api.call(applyAsOrganiser, { token: user.token, body: application });
    expect(again.status).toBe(409);
  });

  it("lets a rejected applicant edit and resubmit, clearing the old decision", async () => {
    const admin = await signUpAdmin(api);
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });

    const earlyResubmit = await api.call(resubmitOrganiser, { token: user.token, body: application, method: "PATCH" });
    expect(earlyResubmit.status).toBe(409);

    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      body: { reason: "Need a portfolio link" },
    });
    const rejected = await api.call(getMyOrganiser, { token: user.token });
    expect(rejected.body).toMatchObject({ status: "rejected", rejectionReason: "Need a portfolio link" });
    // The applicant never sees which admin reviewed them.
    expect(rejected.body.reviewedBy).toBeUndefined();

    const res = await api.call(resubmitOrganiser, {
      token: user.token,
      body: { ...application, displayName: "Static Collective Inc." },
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "pending", displayName: "Static Collective Inc." });
    expect(res.body.rejectionReason).toBeUndefined();
    expect(res.body.reviewedAt).toBeUndefined();
  });
});

describe("admin review of applications", () => {
  it("approves a pending application exactly once", async () => {
    const admin = await signUpAdmin(api);
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });
    const params = { organiserId: applied.body.organiserId };

    const first = await api.call(adminApproveOrganiser, { token: admin.token, params, method: "POST" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "approved", reviewedBy: admin.userId });
    expect(first.body.reviewedAt).toBeTruthy();

    // A second admin clicking approve on a stale queue gets a conflict, not a second decision.
    const second = await api.call(adminApproveOrganiser, { token: admin.token, params, method: "POST" });
    expect(second.status).toBe(409);
  });

  it("requires a reason to reject", async () => {
    const admin = await signUpAdmin(api);
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });
    const res = await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      body: { reason: "  " },
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.reason).toBeTruthy();
  });

  it("a non-admin can't approve their own application", async () => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });
    const res = await api.call(adminApproveOrganiser, {
      token: user.token,
      params: { organiserId: applied.body.organiserId },
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect((await api.call(getMyOrganiser, { token: user.token })).body.status).toBe("pending");
  });

  it("returns 409 for an id that doesn't exist or isn't a uuid", async () => {
    const admin = await signUpAdmin(api);
    for (const organiserId of [crypto.randomUUID(), "not-a-uuid"]) {
      const res = await api.call(adminApproveOrganiser, { token: admin.token, params: { organiserId }, method: "POST" });
      expect(res.status).toBe(409);
    }
  });

  it("lists applications by status, paginated", async () => {
    const admin = await signUpAdmin(api);
    for (let i = 0; i < 3; i += 1) {
      const user = await api.signUp();
      await api.call(applyAsOrganiser, { token: user.token, body: { ...application, displayName: `Org ${i}` } });
    }
    const page1 = await api.call(adminListOrganisers, { token: admin.token, query: { status: "pending", limit: "2" } });
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await api.call(adminListOrganisers, {
      token: admin.token,
      query: { status: "pending", limit: "2", cursor: page1.body.nextCursor },
    });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeUndefined();

    const approved = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    expect(approved.body.items).toEqual([]);
    expect((await api.call(adminListOrganisers, { token: admin.token, query: { status: "bogus" } })).status).toBe(400);
    expect((await api.call(adminListOrganisers, { token: admin.token, query: { cursor: "%%%" } })).status).toBe(400);
  });
});

describe("Stripe Connect onboarding", () => {
  it("requires an approved organiser", async () => {
    const user = await api.signUp();
    await api.call(applyAsOrganiser, { token: user.token, body: application });
    expect((await api.call(connectOnboard, { token: user.token, method: "POST" })).status).toBe(403);
  });

  it("creates the Express account once and reuses it for later links", async () => {
    const admin = await signUpAdmin(api);
    const organiser = await approvedOrganiser(api, admin);

    const first = await api.call(connectOnboard, { token: organiser.token, method: "POST" });
    expect(first.status).toBe(200);
    expect(first.body.url).toBe("https://connect.stripe.test/onboard");
    await api.call(connectOnboard, { token: organiser.token, method: "POST" });

    expect(api.stripe.accounts.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "express", country: "AU", email: application.contactEmail }),
    );
    expect(api.stripe.accountLinks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ account: "acct_test_1", return_url: "https://sheltuh.test/dashboard/payouts?connected=1" }),
    );
  });

  it("refresh mirrors Stripe's own account status", async () => {
    const admin = await signUpAdmin(api);
    const organiser = await approvedOrganiser(api, admin);
    await api.call(connectOnboard, { token: organiser.token, method: "POST" });

    api.stripe.accounts.retrieve.mockResolvedValueOnce({ charges_enabled: true, payouts_enabled: false });
    expect((await api.call(connectRefresh, { token: organiser.token, method: "POST" })).body.payoutsEnabled).toBe(false);

    const res = await api.call(connectRefresh, { token: organiser.token, method: "POST" });
    expect(res.body.payoutsEnabled).toBe(true);
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.payoutsEnabled).toBe(true);
  });
});
