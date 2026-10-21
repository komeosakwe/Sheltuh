// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import EventTile from "@/components/ui/EventTile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

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
    expect(screen.getByRole("link", { name: new RegExp(liveEvent.title) })).toHaveAttribute(
      "href",
      `/events/${liveEvent.slug}`,
    );
  });

  it("reads and tabs: the tile's link, then the heart, then 'By organiser'", () => {
    withHearts(<EventTile event={liveEvent} />);
    const tile = screen.getByRole("link", { name: new RegExp(liveEvent.title) });
    const heart = screen.getByRole("button", { name: `Save ${liveEvent.title}` });
    const organiser = screen.getByRole("link", { name: "By Northside Noise" });
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button"));
    expect(focusable).toEqual([tile, heart, organiser]);
    // Still drawn over the art's corner, wherever it sits in the DOM.
    expect(heart).toHaveClass("absolute", "right-1", "top-1");
  });

  it("wraps a long organiser name to two lines rather than cutting it to one", () => {
    render(<EventTile event={{ ...liveEvent, organiserName: "The Very Long Name Collective of Northside" }} />);
    const name = screen.getByText("By The Very Long Name Collective of Northside");
    expect(name).toHaveClass("line-clamp-2");
    expect(name).not.toHaveClass("truncate");
  });

  it("has no organiser link for a demo event (no organiserId) or with showOrganiser={false}", () => {
    render(<EventTile event={sampleEvents[0]} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
    cleanup();
    render(<EventTile event={liveEvent} showOrganiser={false} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
  });
});
