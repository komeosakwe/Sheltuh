// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTicketEvent } from "@/components/tickets/useTicketEvent";
import { sampleTicketOrder } from "@/lib/sample-order";
import type { SheltuhEvent } from "@/lib/types";

const sample = sampleTicketOrder();
if (!sample) throw new Error("the samples have no ticketed event");
const base = sample.event;

const getPublicEventBySlug = vi.fn();
vi.mock("@/lib/api/public-events", () => ({ getPublicEventBySlug: (...args: unknown[]) => getPublicEventBySlug(...args) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), isApiConfigured: true }));
// The adapter's own mapping is tested elsewhere: here each slug loads an event carrying it.
vi.mock("@/lib/live/adapt", () => ({ adaptPublicEvent: (event: { slug: string }): SheltuhEvent => ({ ...base, slug: event.slug, venueAddress: `${event.slug} street` }) }));

afterEach(() => {
  cleanup();
  getPublicEventBySlug.mockReset();
});

describe("useTicketEvent", () => {
  it("loads the event behind the ticket's slug", async () => {
    getPublicEventBySlug.mockResolvedValue({ slug: "first" });
    const { result } = renderHook(() => useTicketEvent("first"));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.slug).toBe("first"));
  });

  it("a failed load for another slug never shows the earlier event's details", async () => {
    getPublicEventBySlug.mockImplementation(async (slug: string) => {
      if (slug === "first") return { slug };
      throw new Error("offline");
    });
    const { result, rerender } = renderHook(({ slug }) => useTicketEvent(slug), { initialProps: { slug: "first" } });
    await waitFor(() => expect(result.current?.venueAddress).toBe("first street"));
    rerender({ slug: "second" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(getPublicEventBySlug).toHaveBeenCalledWith("second"));
    // Let the failed load settle: still nothing, not the first event's address.
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("no slug: nothing to load", () => {
    const { result } = renderHook(() => useTicketEvent(null));
    expect(result.current).toBeNull();
    expect(getPublicEventBySlug).not.toHaveBeenCalled();
  });
});
