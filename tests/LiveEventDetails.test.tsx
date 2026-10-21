// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveEventDetails from "@/components/LiveEventDetails";
import { ApiError } from "@/lib/api/client";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The live event page's own states (docs/design/brand-direction-one.md
 * §6.14): the branded loader, a 404, and an error with "Try again", plus the
 * document title for each.
 */
const getPublicEventBySlug = vi.fn();
vi.mock("@/lib/api/public-events", () => ({
  getPublicEventBySlug: (...args: unknown[]) => getPublicEventBySlug(...args),
}));
// The loaded page's own requests (view beacon, Who's Going) aren't what's tested here.
vi.mock("@/lib/api/analytics", () => ({ recordEventView: vi.fn(), recordOutboundClick: vi.fn() }));
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: () => new Promise(() => {}),
  getMyGoingStatus: () => new Promise(() => {}),
  listGoingAttendees: () => new Promise(() => {}),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/events/neon-static",
  useSearchParams: () => new URLSearchParams(),
}));

function publicEvent(slug: string): PublicEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return {
    organiserId: "org-1",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: event.startsAt,
    endsAt: event.endsAt ?? event.startsAt,
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    ticketingMode: "sheltuh",
    externalTicketUrl: undefined,
    externalFree: false,
    externalProvider: null,
  };
}

/** A promise settled from the test. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  document.title = "Sheltüh";
});
afterEach(() => {
  cleanup();
  getPublicEventBySlug.mockReset();
});

describe("LiveEventDetails", () => {
  it("shows the branded loader as a status while loading, then titles the tab with the event", async () => {
    const load = deferred<PublicEvent>();
    getPublicEventBySlug.mockReturnValue(load.promise);
    render(<LiveEventDetails slug="neon-static" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading event…");
    expect(document.title).toBe("Sheltüh");

    await act(async () => load.resolve(publicEvent("neon-static")));
    expect(screen.getByRole("heading", { level: 1, name: "Neon Static" })).toBeInTheDocument();
    expect(document.title).toBe("Neon Static — Sheltüh");
  });

  it("titles a missing event 'Event not found'", async () => {
    getPublicEventBySlug.mockRejectedValue(new ApiError(404, "Event not found."));
    render(<LiveEventDetails slug="gone" />);
    // NotFoundMessage owns the wording.
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    // The title is set in an effect after the heading renders.
    await waitFor(() => expect(document.title).toBe("Event not found — Sheltüh"));
  });

  it("on an error: a heading, the reason as an alert, Try again and a way back; titled to match", async () => {
    getPublicEventBySlug.mockRejectedValue(new ApiError(503, "The service is busy."));
    render(<LiveEventDetails slug="neon-static" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Couldn’t load this event" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The service is busy.");
    expect(alert).toHaveClass("border-danger");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("btn-outline");
    expect(screen.getByRole("link", { name: "Back to all events" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toBe("Couldn’t load event — Sheltüh"));
  });

  it("Try again keeps focus on the button while it works and if it fails again, re-announcing the error", async () => {
    getPublicEventBySlug.mockRejectedValueOnce(new ApiError(503, "The service is busy."));
    render(<LiveEventDetails slug="neon-static" />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    const firstAlert = screen.getByRole("alert");
    retry.focus();

    const second = deferred<PublicEvent>();
    getPublicEventBySlug.mockReturnValueOnce(second.promise);
    fireEvent.click(retry);
    expect(getPublicEventBySlug).toHaveBeenCalledTimes(2);
    // Busy, not disabled: focus stays put, and a press meanwhile does nothing.
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByText("Trying again…", { selector: "[role=status]" })).toBeInTheDocument();
    fireEvent.click(retry);
    expect(getPublicEventBySlug).toHaveBeenCalledTimes(2);

    await act(async () => second.reject(new ApiError(503, "Still busy.")));
    expect(retry).toHaveFocus();
    expect(retry).not.toHaveAttribute("aria-disabled", "true");
    // A new alert element, so it's announced again.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Still busy.");
    expect(alert).not.toBe(firstAlert);
  });

  it("when Try again gets the event, focus moves to its title", async () => {
    getPublicEventBySlug.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<LiveEventDetails slug="neon-static" />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();
    getPublicEventBySlug.mockResolvedValueOnce(publicEvent("neon-static"));
    await act(async () => fireEvent.click(retry));
    const heading = screen.getByRole("heading", { level: 1, name: "Neon Static" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe("Neon Static — Sheltüh");
  });
});

describe("LiveEventDetails document title vs streamed metadata", () => {
  it("keeps the event's title when the route's own title lands afterwards", async () => {
    getPublicEventBySlug.mockResolvedValue(publicEvent("neon-static"));
    render(<LiveEventDetails slug="neon-static" />);
    await screen.findByRole("heading", { level: 1, name: "Neon Static" });
    expect(document.title).toBe("Neon Static — Sheltüh");
    // As Next does when generateMetadata's result streams in late.
    await act(async () => {
      document.title = "Sheltüh";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.title).toBe("Neon Static — Sheltüh");
  });
});
