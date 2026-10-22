// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import EventTile from "@/components/ui/EventTile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // The sample events are dated Sept–Nov 2026, and an ended event gets no quick buy: read them before then.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const liveEvent: SheltuhEvent = {
  ...sampleEvents[0],
  organiserId: "org-1",
  organiserName: "Northside Noise",
};

/** Demo favourites (accounts not configured): the heart renders without any API. */
function withHearts(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>{children}</FavouritesProvider>
    </FakeAuthProvider>,
  );
}

describe("EventTile organiser link", () => {
  it("links a live event's organiser to their profile, beside (never inside) the tile's link", () => {
    render(<EventTile event={liveEvent} />);
    const organiser = screen.getByRole("link", { name: "By Northside Noise" });
    expect(organiser).toHaveAttribute("href", "/organisers/org-1");
    // No nested anchors: the organiser link has no link ancestor.
    expect(organiser.parentElement?.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: new RegExp(`^${liveEvent.title}`) })).toHaveAttribute(
      "href",
      `/events/${liveEvent.slug}`,
    );
  });

  it("reads and tabs: the tile's link, the heart, Buy tickets, then 'By organiser'", () => {
    withHearts(<EventTile event={liveEvent} />);
    const tile = screen.getByRole("link", { name: new RegExp(`^${liveEvent.title}`) });
    const heart = screen.getByRole("button", { name: `Save ${liveEvent.title}` });
    const buy = screen.getByRole("link", { name: `Buy tickets for ${liveEvent.title}` });
    const organiser = screen.getByRole("link", { name: "By Northside Noise" });
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button"));
    expect(focusable).toEqual([tile, heart, buy, organiser]);
    // Still drawn over the art's corner, wherever it sits in the DOM.
    expect(heart).toHaveClass("absolute", "right-1", "top-1");
  });

  it("wraps a long organiser name to two lines rather than cutting it to one", () => {
    render(<EventTile event={{ ...liveEvent, organiserName: "The Very Long Name Collective of Northside" }} />);
    const name = screen.getByText("By The Very Long Name Collective of Northside");
    expect(name).toHaveClass("line-clamp-2");
    expect(name).not.toHaveClass("truncate");
  });

  it("in the demo, links a sample event's organiser to the sample organiser's profile", () => {
    const sample = sampleEvents.find((e) => e.slug === "dead-letter-office");
    if (!sample) throw new Error("no sample dead-letter-office");
    expect(sample.organiserId).toBeUndefined();
    render(<EventTile event={sample} />);
    expect(screen.getByRole("link", { name: "By Small Hours Theatre" })).toHaveAttribute(
      "href",
      "/organisers/small-hours-theatre",
    );
  });

  it("has no organiser link without a profile to link to, or with showOrganiser={false}", () => {
    render(<EventTile event={{ ...sampleEvents[0], organiserName: "Nobody In The Samples" }} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
    cleanup();
    render(<EventTile event={sampleEvents[0]} showOrganiser={false} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
    cleanup();
    render(<EventTile event={liveEvent} showOrganiser={false} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
  });
});

describe("EventTile card anatomy (brand-direction-one.md §6.5)", () => {
  it("names its link by the title first, then the date, place, all-inclusive price and category", () => {
    render(<EventTile event={liveEvent} />);
    const tile = screen.getByRole("link", { name: new RegExp(`^${liveEvent.title}`) });
    expect(tile).toHaveAccessibleName(/incl\. booking fee/);
    expect(tile).toHaveAccessibleName(new RegExp(liveEvent.suburb));
  });

  it("leads with a 4:5 rounded photo and a mono date line", () => {
    const { container } = render(<EventTile event={liveEvent} />);
    expect(container.querySelector(".aspect-\\[4\\/5\\]")).not.toBeNull();
    expect(container.querySelector(".rounded-card")).not.toBeNull();
    expect(container.querySelector("p.meta")).toHaveTextContent(/·/);
  });

  it("has an orange quick-buy link outside the card's link, to the event's tickets", () => {
    render(<EventTile event={liveEvent} />);
    const buy = screen.getByRole("link", { name: `Buy tickets for ${liveEvent.title}` });
    expect(buy).toHaveAttribute("href", `/events/${liveEvent.slug}#tickets`);
    expect(buy).toHaveClass("btn", "btn-signal", "min-h-11", "w-full", "sm:w-auto");
    expect(buy.closest(`a[href="/events/${liveEvent.slug}"]`)).toBeNull();
  });

  it("says 'Get free tickets' for an all-free event, and has no quick buy before tickets exist", () => {
    const free: SheltuhEvent = { ...liveEvent, ticketTypes: liveEvent.ticketTypes.map((t) => ({ ...t, priceCents: 0 })) };
    render(<EventTile event={free} />);
    expect(screen.getByRole("link", { name: `Get free tickets for ${free.title}` })).toBeInTheDocument();
    cleanup();
    render(<EventTile event={{ ...liveEvent, ticketTypes: [] }} />);
    expect(screen.queryByRole("link", { name: /tickets for/ })).toBeNull();
  });
});

