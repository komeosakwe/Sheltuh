import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { adminCancelTicketTransfer, adminListEmailJobs, adminListTicketTransfers } = await import("@/lib/api/admin");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adminListEmailJobs", () => {
  it("sends `reference` whenever one is given (an empty one too, for the API's 400), and leaves it out otherwise", async () => {
    const fetch = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const getToken = async () => "token";
    const query = (call: number) => new URL(fetch.mock.calls[call][0] as string, "http://x").searchParams;

    await adminListEmailJobs("failed", getToken);
    expect(query(0).has("reference")).toBe(false);
    await adminListEmailJobs("failed", getToken, undefined, "#7C1F2E0A");
    expect(query(1).get("reference")).toBe("#7C1F2E0A");
    await adminListEmailJobs("failed", getToken, undefined, "");
    expect(query(2).get("reference")).toBe("");
  });
});

describe("ticket transfers (support)", () => {
  function stubFetch(body: unknown) {
    const fetch = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const getToken = async () => "token";

  it("lists with an optional reference and cursor in the query", async () => {
    const fetch = stubFetch({ items: [] });
    await adminListTicketTransfers(getToken);
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/ticket-transfers$/);
    await adminListTicketTransfers(getToken, { reference: "#7C1F2E0A", cursor: "c1" });
    const qs = new URL(fetch.mock.calls[1][0] as string, "http://x").searchParams;
    expect([qs.get("reference"), qs.get("cursor")]).toEqual(["#7C1F2E0A", "c1"]);
    expect((fetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer token" });
  });

  it("cancels with the reason in a POST body", async () => {
    const fetch = stubFetch({ result: "cancelled" });
    await expect(adminCancelTicketTransfer("t/1", "Buyer asked", getToken)).resolves.toEqual({ result: "cancelled" });
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/admin\/ticket-transfers\/t%2F1\/cancel$/);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Buyer asked" });
  });
});
