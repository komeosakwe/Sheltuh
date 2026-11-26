import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { ensureQrTrackingLink, QR_TRACKING_LABEL } = await import("@/lib/api/analytics");

afterEach(() => {
  vi.unstubAllGlobals();
});

const getToken = async () => "tok";

function link(label: string, code = "k7mq2hxd") {
  return {
    linkId: `l-${code}`,
    code,
    label,
    url: `https://sheltuh.com.au/events/night-market?ref=${code}`,
    createdAt: "2026-11-26T00:00:00.000Z",
    views: 0,
    orders: 0,
    ticketsSold: 0,
    grossCents: 0,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers each request in turn; records what was asked. */
function stub(...responses: Response[]) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const LIST = "/api/organisers/me/events/evt%201/tracking-links";

describe("ensureQrTrackingLink", () => {
  it("reuses the event's existing QR code link, whatever its case, without making one", async () => {
    const existing = link("qr CODE", "abcd2345");
    const fetch = stub(json({ items: [link("Instagram", "zzzz2345"), existing] }));
    await expect(ensureQrTrackingLink("evt 1", getToken)).resolves.toEqual(existing);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(LIST);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("makes the link the first time: the list is empty, then a POST labelled “QR code”", async () => {
    const made = link(QR_TRACKING_LABEL);
    const fetch = stub(json({ items: [] }), json(made, 201));
    await expect(ensureQrTrackingLink("evt 1", getToken)).resolves.toEqual(made);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(LIST);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ label: "QR code" });
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("lost a race (409 on the label: another tab made it): reads the list again and uses that one", async () => {
    const raced = link("QR code", "race2345");
    const fetch = stub(
      json({ items: [] }),
      json({ error: "Label taken.", fieldErrors: { label: "You already have a link with this label." } }, 409),
      json({ items: [raced] }),
    );
    await expect(ensureQrTrackingLink("evt 1", getToken)).resolves.toEqual(raced);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("a 409 on the label with still no QR link in the list is an error, not a silent fallback", async () => {
    stub(json({ items: [] }), json({ error: "Label taken.", fieldErrors: { label: "Taken." } }, 409), json({ items: [] }));
    await expect(ensureQrTrackingLink("evt 1", getToken)).rejects.toMatchObject({ status: 409 });
  });

  it("at the 20-link cap (a 409 with no label error) resolves to null: the code opens the plain page", async () => {
    const fetch = stub(json({ items: Array.from({ length: 20 }, (_, i) => link(`Link ${i}`, `code${i}aa`)) }), json({ error: "This event already has 20 tracking links." }, 409));
    await expect(ensureQrTrackingLink("evt 1", getToken)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("anything else throws with the API's status: a failed list, or a failed create", async () => {
    stub(json({ error: "Not found." }, 404));
    await expect(ensureQrTrackingLink("evt 1", getToken)).rejects.toMatchObject({ status: 404 });
    stub(json({ items: [] }), json({ error: "Server error." }, 500));
    await expect(ensureQrTrackingLink("evt 1", getToken)).rejects.toMatchObject({ status: 500 });
  });
});
