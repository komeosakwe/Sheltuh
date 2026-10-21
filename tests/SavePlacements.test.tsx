// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import EventResults from "@/components/EventResults";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import FeaturedEventCard from "@/components/home/phone/FeaturedEventCard";
import HomeEventCard from "@/components/home/phone/HomeEventCard";
import EventTile from "@/components/ui/EventTile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const recordEventView = vi.fn();
vi.mock("@/lib/api/analytics", () => ({
  recordEventView: (...args: unknown[]) => recordEventView(...args),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getGoingSummary = vi.fn();
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...a: unknown[]) => getGoingSummary(...a),
  getMyGoingStatus: vi.fn(),
  listGoingAttendees: vi.fn(),
}));

beforeEach(() => {
  recordEventView.mockReset();
  getGoingSummary.mockReset().mockResolvedValue({ count: 0, closed: true, countHidden: false });
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

const EVENT = sampleEvents[0];

/** Demo favourites (accounts not configured): hearts work without any API. */
function withHearts(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>{children}</FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const heartFor = (event: SheltuhEvent) => screen.getByRole("button", { name: `Save ${event.title}` });

describe("heart placements", () => {
  it("EventTile: a sibling of the link (never inside it), right after it in tab order", () => {
    const { container } = withHearts(<EventTile event={EVENT} />);
    const link = screen.getByRole("link");
    const heart = heartFor(EVENT);
    expect(link.contains(heart)).toBe(false);
    expect(link.compareDocumentPosition(heart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heart).toHaveClass("absolute", "right-1", "top-1");
    expect(container.firstElementChild).toHaveClass("relative");
  });

  it("EventTile: showSave={false} leaves the heart off", () => {
    withHearts(<EventTile event={EVENT} showSave={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["standard", "wide", "compact"] as const)("HomeEventCard %s has a heart beside its link", (variant) => {
    withHearts(<HomeEventCard event={EVENT} variant={variant} mode="demo" />);
    const heart = heartFor(EVENT);
    expect(screen.getByRole("link").contains(heart)).toBe(false);
    expect(heart).toHaveAttribute("data-save-variant", variant === "compact" ? "plain" : "overlay");
  });

  it("FeaturedEventCard has an overlay heart", () => {
    withHearts(<FeaturedEventCard event={EVENT} mode="demo" />);
    expect(heartFor(EVENT)).toHaveAttribute("data-save-variant", "overlay");
  });

  it("event page: a Save pill by the title, and a buy-bar heart from 375px", () => {
    const { container } = withHearts(<EventDetailsView event={EVENT} demo />);
    const hearts = screen.getAllByRole("button", { name: `Save ${EVENT.title}` });
    expect(hearts.map((h) => h.getAttribute("data-save-variant"))).toEqual(["pill", "onDark"]);
    expect(hearts[0]).toHaveTextContent("Save");
    const buyBar = container.querySelector<HTMLElement>("[data-buy-bar]");
    if (!buyBar) throw new Error("buy bar not rendered");
    const barHeart = within(buyBar).getByRole("button", { name: `Save ${EVENT.title}` });
    expect(barHeart).toHaveClass("hidden", "min-[375px]:flex");
  });
});

describe("event page view count", () => {
  it("live: counts the view once", async () => {
    const live: SheltuhEvent = { ...EVENT, id: "evt-live", organiserId: "org-1" };
    withHearts(<EventDetailsView event={live} demo={false} />);
    await waitFor(() => expect(recordEventView).toHaveBeenCalledTimes(1));
    expect(recordEventView).toHaveBeenCalledWith("evt-live", { source: "direct" });
  });

  it("demo: sends nothing", async () => {
    withHearts(<EventDetailsView event={EVENT} demo />);
    await new Promise((r) => setTimeout(r, 0));
    expect(recordEventView).not.toHaveBeenCalled();
  });
});

describe("EventResults layout='grid'", () => {
  it("puts every event in the grid, with no carousel", () => {
    const events = sampleEvents.slice(0, 5);
    render(<EventResults events={events} layout="grid" />);
    expect(screen.queryByRole("region", { name: "Events" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });
});
