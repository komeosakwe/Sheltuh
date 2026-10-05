// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventsPage from "@/app/events/page";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listPublicEvents = vi.fn();
vi.mock("@/lib/api/public-events", () => ({
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  listPublicEvents.mockReset();
  listPublicEvents.mockResolvedValue({ items: [], nextCursor: undefined });
});

async function renderPage(searchParams: Record<string, string | string[] | undefined>) {
  render(await EventsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }));
  await waitFor(() => expect(listPublicEvents).toHaveBeenCalled());
}

describe("/events query params (live)", () => {
  it("sends the starting category and pricing to the API", async () => {
    await renderPage({ category: "workshop", pricing: "free" });
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listPublicEvents.mock.calls[0][0]).toMatchObject({ category: "workshop", pricing: "free" });
    expect(screen.getByLabelText("Category")).toHaveValue("workshop");
  });

  it("sends no filters for unknown values or a plain /events", async () => {
    await renderPage({ category: "nightlife", pricing: "cheap" });
    expect(listPublicEvents.mock.calls[0][0]).toMatchObject({ category: undefined, pricing: undefined });
    cleanup();
    listPublicEvents.mockClear();
    await renderPage({});
    expect(listPublicEvents.mock.calls[0][0]).toMatchObject({ category: undefined, pricing: undefined });
  });
});
