// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import EventCard from "@/components/ui/EventCard";
import SoonTag from "@/components/ui/SoonTag";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/*
 * The "soon" tag (owner request, 13 Nov 2026): "🔥 Tomorrow" beside the category on the card and the event
 * page, beside the tickets heading, and leading the phone buy bar's date line. Time only, read from the
 * browser's clock after hydration (none in the server's HTML), the flame hidden from screen readers.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Fri 13 Nov 2026, 10:00 am in Melbourne (AEDT).
const NOW = new Date("2026-11-12T23:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return event;
}

// General admission, on sale, a buy bar: re-timed for each case.
const base = sample("neon-static");
/** Sat 14 Nov, 5:00–9:00 pm Melbourne: tomorrow. */
const tomorrow: SheltuhEvent = { ...base, startsAt: "2026-11-14T06:00:00.000Z", endsAt: "2026-11-14T10:00:00.000Z" };
/** Fri 13 Nov, 8:00–11:00 pm Melbourne: tonight. */
const tonight: SheltuhEvent = { ...base, startsAt: "2026-11-13T09:00:00.000Z", endsAt: "2026-11-13T12:00:00.000Z" };
/** Tue 17 Nov: nothing. */
const later: SheltuhEvent = { ...base, startsAt: "2026-11-17T08:00:00.000Z", endsAt: "2026-11-17T11:00:00.000Z" };

const soonTags = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-tag="soon"]')];

describe("SoonTag", () => {
  it("is the tags' shape in its own tint, the words read and the flame hidden", () => {
    render(<SoonTag event={tomorrow} />);
    const tag = screen.getByText("Tomorrow").closest<HTMLElement>("[data-tag]") as HTMLElement;
    expect(tag).toHaveAttribute("data-tag", "soon");
    expect(tag).toHaveClass("label-tag", "h-6", "rounded-badge", "px-2");
    expect(tag).not.toHaveAttribute("role");
    expect(tag).toHaveTextContent("🔥Tomorrow");
    const flame = within(tag).getByText("🔥");
    expect(flame).toHaveAttribute("aria-hidden", "true");
  });

  it("is nothing in the server's HTML, so hydration has nothing to disagree with", () => {
    expect(renderToString(<SoonTag event={tomorrow} />)).toBe("");
  });

  it("is nothing for an event further off, or one that has ended", () => {
    const { container } = render(
      <>
        <SoonTag event={later} />
        <SoonTag event={{ ...base, startsAt: "2026-11-12T08:00:00.000Z", endsAt: "2026-11-12T11:00:00.000Z" }} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("follows the clock each minute: Tonight turns to On now when it starts", () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T08:59:30.000Z")); // 7:59:30 pm
    render(<SoonTag event={tonight} />);
    expect(screen.getByText("Tonight")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText("On now")).toBeInTheDocument();
    expect(screen.queryByText("Tonight")).toBeNull();
  });
});

describe("on the event card", () => {
  it("sits next to the category tag, before any state tag", () => {
    const { container } = render(<EventCard event={{ ...tomorrow, seating: { version: 1 }, ticketTypes: base.ticketTypes.map((t) => ({ ...t, seated: true })) }} mode="demo" now={NOW} showSave={false} />);
    const tags = container.querySelector<HTMLElement>("[data-card-tags]") as HTMLElement;
    expect([...tags.children].map((tag) => tag.getAttribute("data-tag"))).toEqual(["live-music", "soon", "neutral"]);
    expect(tags).toHaveTextContent(/^Live music🔥TomorrowReserved seating$/);
  });

  it("says Tonight for this evening and nothing for next week", () => {
    const { container, unmount } = render(<EventCard event={tonight} mode="demo" now={NOW} showSave={false} />);
    expect(soonTags(container).map((tag) => tag.textContent)).toEqual(["🔥Tonight"]);
    unmount();
    const none = render(<EventCard event={later} mode="demo" now={NOW} showSave={false} />);
    expect(soonTags(none.container)).toEqual([]);
  });

  it("never on an ended card", () => {
    vi.setSystemTime(new Date("2026-11-15T00:00:00.000Z"));
    const { container } = render(<EventCard event={tomorrow} mode="demo" now={new Date("2026-11-15T00:00:00.000Z")} showSave={false} />);
    expect(container.querySelector("[data-card-state]")).toHaveAttribute("data-card-state", "ended");
    expect(soonTags(container)).toEqual([]);
  });
});

describe("on the event page", () => {
  it("beside the category, beside the tickets heading (not in its name), and leading the buy bar's date line", () => {
    const { container } = render(<EventDetailsView event={tomorrow} demo />);
    const tags = container.querySelector<HTMLElement>("[data-event-tags]") as HTMLElement;
    // The category, the soon tag, then the sample's age tag.
    expect([...tags.children].map((tag) => tag.getAttribute("data-tag"))).toEqual(["live-music", "soon", "neutral"]);

    const head = container.querySelector<HTMLElement>("[data-tickets-head]") as HTMLElement;
    expect(within(head).getByRole("heading", { level: 2, name: "Select your tickets" })).toBeInTheDocument();
    expect(soonTags(head).map((tag) => tag.textContent)).toEqual(["🔥Tomorrow"]);

    const date = container.querySelector<HTMLElement>("[data-buy-bar] [data-bar-date]") as HTMLElement;
    expect(date).toHaveTextContent(/^🔥Tomorrow · Sat 14 Nov · 5:00 pm$/);
    // One line: the label is kept whole, the date gives way.
    expect(date).toHaveClass("flex", "min-w-0");
    expect(date.querySelector("[data-soon-text]")).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(within(date).getByText("Sat 14 Nov · 5:00 pm")).toHaveClass("truncate", "min-w-0");
    expect(within(date).getByText("🔥")).toHaveAttribute("aria-hidden", "true");
  });

  it("an external event's bar and a seated event's bar lead with it too", () => {
    const external: SheltuhEvent = {
      ...tomorrow,
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/x",
      externalFree: true,
    };
    const { container, unmount } = render(<EventDetailsView event={external} demo />);
    expect(container.querySelector("[data-buy-bar] [data-bar-date]")).toHaveTextContent(/^🔥Tomorrow/);
    unmount();
    const seated = sample("off-kilter-a-new-play"); // Sat 14 Nov, 7:00 pm
    const page = render(<EventDetailsView event={seated} demo />);
    expect(page.container.querySelector("[data-buy-bar] [data-bar-date]")).toHaveTextContent(/^🔥Tomorrow · Sat 14 Nov · 7:00 pm$/);
  });

  it("nowhere when the event isn't close: the tags, heading and date line are as before", () => {
    const { container } = render(<EventDetailsView event={later} demo />);
    expect(soonTags(container)).toEqual([]);
    expect(container.querySelector("[data-soon-text]")).toBeNull();
    expect(container.querySelector("[data-buy-bar] [data-bar-date]")).toHaveTextContent(/^Tue 17 Nov · 7:00 pm$/);
  });

  it("nothing in the server's HTML", () => {
    const html = renderToString(<EventDetailsView event={tomorrow} demo />);
    expect(html).not.toContain('data-tag="soon"');
    expect(html).not.toContain("🔥");
  });
});
