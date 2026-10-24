// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminTrendingList from "@/components/admin/AdminTrendingList";
import TrendingPanel, { describeCurationChange } from "@/components/admin/TrendingPanel";
import { ApiError } from "@/lib/api/client";
import type { EventCuration, TrendingEvent } from "@/lib/api/trending";

const getEventCuration = vi.fn();
const setEventCuration = vi.fn();
const getTrendingEvents = vi.fn();
vi.mock("@/lib/api/trending", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/trending")>()),
  getEventCuration: (...args: unknown[]) => getEventCuration(...args),
  setEventCuration: (...args: unknown[]) => setEventCuration(...args),
  getTrendingEvents: (...args: unknown[]) => getTrendingEvents(...args),
}));

const CURATION: EventCuration = {
  eventId: "evt-1",
  boost: 1,
  excluded: false,
  updatedAt: null,
  log: [],
};

const getToken = vi.fn().mockResolvedValue("t");

beforeEach(() => {
  getEventCuration.mockReset();
  setEventCuration.mockReset();
  getTrendingEvents.mockReset();
});
afterEach(cleanup);

describe("TrendingPanel", () => {
  it("shows the current boost and lets an admin change it with a reason", async () => {
    getEventCuration.mockResolvedValue(CURATION);
    setEventCuration.mockResolvedValue({
      ...CURATION,
      boost: 1.5,
      updatedAt: "2026-10-24T01:00:00.000Z",
      log: [
        { by: "u1", at: "2026-10-24T01:00:00.000Z", reason: "Local favourite", changes: { boost: { old: 1, new: 1.5 } } },
      ],
    });
    render(<TrendingPanel eventId="evt-1" getToken={getToken} />);
    const panel = screen.getByRole("region", { name: "Trending" });
    expect(await within(panel).findByText(/^Now:/)).toHaveTextContent("Now: Normal (×1)");
    expect(within(panel).getByText("No changes yet.")).toBeInTheDocument();

    fireEvent.change(within(panel).getByRole("combobox", { name: "Boost" }), { target: { value: "1.5" } });
    const save = within(panel).getByRole("button", { name: "Save Trending settings" });
    await act(async () => {
      fireEvent.click(save);
    });
    // A reason is required first.
    expect(setEventCuration).not.toHaveBeenCalled();
    const reason = within(panel).getByRole("textbox", { name: /Reason \(admins only\)/ });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAccessibleDescription(/Enter a reason\./);

    fireEvent.change(reason, { target: { value: "Local favourite" } });
    save.focus();
    await act(async () => {
      fireEvent.click(save);
    });
    expect(setEventCuration).toHaveBeenCalledWith(
      "evt-1",
      { boost: 1.5, excluded: false, reason: "Local favourite" },
      getToken,
    );
    expect(within(panel).getByRole("status")).toHaveTextContent("Saved: More (×1.5), allowed in Trending.");
    expect(within(panel).getByText(/Boost ×1 → ×1.5/)).toBeInTheDocument();
    expect(within(panel).getByText("Local favourite")).toBeInTheDocument();
    // The form stays put, so focus isn't lost to the page.
    expect(save).toHaveFocus();
  });

  it("says when nothing has changed, and ties an API field error to its field", async () => {
    getEventCuration.mockResolvedValue(CURATION);
    setEventCuration.mockRejectedValue(
      new ApiError(400, "Invalid", { reason: "Reasons can't contain control characters." }),
    );
    render(<TrendingPanel eventId="evt-1" getToken={getToken} />);
    const panel = screen.getByRole("region", { name: "Trending" });
    await within(panel).findByText(/^Now:/);
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Save Trending settings" }));
    });
    expect(within(panel).getByRole("alert")).toHaveTextContent("Nothing has changed");

    fireEvent.click(within(panel).getByRole("checkbox", { name: "Keep out of Trending" }));
    fireEvent.change(within(panel).getByRole("textbox", { name: /Reason/ }), { target: { value: "Spam" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Save Trending settings" }));
    });
    const reason = within(panel).getByRole("textbox", { name: /Reason/ });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAccessibleDescription(/control characters/);
  });

  it("a failed load is shown in plain words with Try again", async () => {
    getEventCuration.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValue(CURATION);
    render(<TrendingPanel eventId="evt-1" getToken={getToken} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this event’s Trending settings.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Now:/)).toHaveTextContent("Now: Normal (×1)");
  });

  it("describes log entries in words", () => {
    expect(
      describeCurationChange({ by: "u", at: "", changes: { excluded: { old: false, new: true }, boost: { old: 2, new: 1 } } }),
    ).toBe("Boost ×2 → ×1; Hidden from Trending");
  });
});

describe("AdminTrendingList", () => {
  const item = (eventId: string, title: string, extra: Partial<TrendingEvent> = {}): TrendingEvent => ({
    event: {
      organiserId: "o",
      eventId,
      slug: eventId,
      title,
      description: "",
      category: "live-music",
      venueName: "V",
      venueAddress: "A",
      suburb: "Fitzroy",
      startsAt: "2099-01-01T09:00:00.000Z",
      endsAt: "2099-01-01T12:00:00.000Z",
      organiserName: "Org",
      ticketTypes: [],
    },
    label: "popular",
    ...extra,
  });

  it("lists what's trending in order, each linking to its curation panel", async () => {
    getTrendingEvents.mockResolvedValue({
      items: [item("e1", "First", { label: "going", goingCount: 12 }), item("e2", "Second", { label: "just-announced" })],
    });
    render(<AdminTrendingList />);
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("12 going");
    expect(screen.getByRole("link", { name: "Curate First" })).toHaveAttribute("href", "/admin/events/e1/edit#trending");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Trending now (2)");
  });

  it("explains an empty Trending, and shows a failure with Try again", async () => {
    getTrendingEvents.mockResolvedValueOnce({ items: [] });
    render(<AdminTrendingList />);
    expect(await screen.findByText("Trending is hidden right now")).toBeInTheDocument();
    cleanup();
    getTrendingEvents.mockRejectedValueOnce(new ApiError(503, "x")).mockResolvedValue({ items: [item("e1", "First")] });
    render(<AdminTrendingList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load Trending. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Curate First" })).toBeInTheDocument();
  });
});
