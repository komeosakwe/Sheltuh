import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { checkUsername, clearMyUsername, getMe, listMyTickets, setMyUsername } = await import("@/lib/api/me");
const { ApiError } = await import("@/lib/api/client");

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const getToken = async () => "tok";

describe("getMe", () => {
  it("GETs /api/me with the bearer token and returns the summary", async () => {
    const fetch = stub({ upcomingCount: 3 });
    await expect(getMe(getToken)).resolves.toEqual({ upcomingCount: 3 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("an error status is an ApiError (403: email not verified)", async () => {
    stub({ error: "Verify your email address first." }, 403);
    await expect(getMe(getToken)).rejects.toSatisfy((err) => err instanceof ApiError && err.status === 403);
  });

  it("an aborted signal cancels it", async () => {
    stub({ upcomingCount: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(getMe(getToken, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("listMyTickets", () => {
  const empty = { items: [], counts: { upcoming: 0, past: 0 } };

  it("GETs /api/me/tickets with the bearer token and returns the page", async () => {
    const fetch = stub(empty);
    await expect(listMyTickets(getToken)).resolves.toEqual(empty);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me/tickets");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("passes the cursor, encoded, and nothing else", async () => {
    const fetch = stub(empty);
    await listMyTickets(getToken, { cursor: "eyJvIjoyMH0=" });
    expect(fetch.mock.calls[0][0]).toBe("/api/me/tickets?cursor=eyJvIjoyMH0%3D");
  });

  it("an error status is an ApiError (403: email not verified)", async () => {
    stub({ error: "Verify your email address first." }, 403);
    await expect(listMyTickets(getToken)).rejects.toSatisfy((err) => err instanceof ApiError && err.status === 403);
  });

  it("an aborted signal cancels it", async () => {
    stub(empty);
    const controller = new AbortController();
    controller.abort();
    await expect(listMyTickets(getToken, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("usernames", () => {
  it("setMyUsername PUTs {username} to /api/me/username and returns the summary", async () => {
    const fetch = stub({ username: "latte", upcomingCount: 0 });
    await expect(setMyUsername("@Latte", getToken)).resolves.toEqual({ username: "latte", upcomingCount: 0 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me/username");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ username: "@Latte" });
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("a taken name is an ApiError 409 carrying the code", async () => {
    stub({ error: "That username is taken. Try another.", fieldErrors: { username: "That username is taken. Try another." }, code: "username_taken" }, 409);
    await expect(setMyUsername("latte", getToken)).rejects.toSatisfy(
      (err) => err instanceof ApiError && err.status === 409 && err.body?.code === "username_taken" && Boolean(err.fieldErrors?.username),
    );
  });

  it("clearMyUsername DELETEs /api/me/username", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(clearMyUsername(getToken)).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me/username");
    expect(init.method).toBe("DELETE");
  });

  it("checkUsername POSTs the name in the body, never the URL", async () => {
    const fetch = stub({ username: "latte", available: true });
    await expect(checkUsername("latte", getToken)).resolves.toEqual({ username: "latte", available: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me/username/check");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ username: "latte" });
  });

  it("checkUsername can be aborted", async () => {
    stub({ username: "latte", available: true });
    const controller = new AbortController();
    controller.abort();
    await expect(checkUsername("latte", getToken, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
