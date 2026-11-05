import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { downloadEventOrdersCsv, getEventOrders } = await import("@/lib/api/event-orders");

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(body: BodyInit | null, status = 200, type = "application/json") {
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status, headers: { "content-type": type } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const getToken = async () => "tok";

describe("getEventOrders", () => {
  it("asks for the event's orders with the token, and only the query parts given", async () => {
    const fetch = stub(JSON.stringify({ items: [], total: 0 }));
    await getEventOrders("evt 1", getToken, { q: "anna & co", cursor: "c1", limit: 20 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/organisers/me/events/evt%201/orders?q=anna+%26+co&cursor=c1&limit=20");
    expect(init.headers.authorization).toBe("Bearer tok");
    await getEventOrders("evt-1", getToken);
    expect(fetch.mock.calls[1][0]).toBe("/api/organisers/me/events/evt-1/orders");
  });

  it("rejects with the API's status", async () => {
    stub(JSON.stringify({ error: "Too many requests." }), 429);
    await expect(getEventOrders("evt-1", getToken)).rejects.toMatchObject({ status: 429 });
  });
});

describe("downloadEventOrdersCsv", () => {
  it("fetches the .csv with the token and resolves to the file", async () => {
    const fetch = stub("Name,Email\r\n", 200, "text/csv");
    const blob = await downloadEventOrdersCsv("evt-1", getToken);
    expect(fetch.mock.calls[0][0]).toBe("/api/organisers/me/events/evt-1/orders.csv");
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
    expect(await blob.text()).toBe("Name,Email\r\n");
  });

  it("rejects with the status and message for a refusal (409 over the cap, 429 after 10 an hour)", async () => {
    stub(JSON.stringify({ error: "Too many orders to export." }), 409);
    await expect(downloadEventOrdersCsv("evt-1", getToken)).rejects.toMatchObject({ status: 409, message: "Too many orders to export." });
    stub(JSON.stringify({ error: "Slow down." }), 429);
    await expect(downloadEventOrdersCsv("evt-1", getToken)).rejects.toMatchObject({ status: 429 });
  });
});
