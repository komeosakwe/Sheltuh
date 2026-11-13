// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneEventRow from "@/components/SceneEventRow";
import { sampleEvents } from "@/lib/sample-events";

/*
 * The Nearby list row (redesign PR 5; mobile polish, 29 Oct 2026): like an event card, the whole
 * row opens the event (the title's link stretches over it), with Locate and the ticket action above it.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const event = sampleEvents[0];

function renderRow(props: { selected?: boolean; hasLocation?: boolean; onLocate?: () => void } = {}) {
  return render(
    <SceneEventRow
      event={event}
      selected={props.selected ?? false}
      hasLocation={props.hasLocation ?? true}
      onLocate={props.onLocate ?? vi.fn()}
      detailsHref={`/events/${event.slug}`}
    />,
  );
}

describe("SceneEventRow", () => {
  it("names the one stretched link by the title and points it at the event", () => {
    const { container } = renderRow();
    const link = screen.getByRole("link", { name: event.title });
    expect(link).toHaveAttribute("href", `/events/${event.slug}`);
    expect(link).toHaveAttribute("data-card-link");
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    expect(container.querySelectorAll("[data-card-link]")).toHaveLength(1);
  });

  it("is the positioning context for the link, with a hover, press and keyboard focus state on the row", () => {
    const { container } = renderRow();
    const row = container.querySelector("[data-scene-row]") as HTMLElement;
    expect(row).toHaveClass("relative", "hover:bg-surface", "has-[[data-card-link]:active]:bg-surface-border");
    expect(row.className).toContain("has-[[data-card-link]:focus-visible]:outline-2");
  });

  it("keeps Locate above the link, 56px from lg (the mocks leave it off below), and calls back with the button", () => {
    const onLocate = vi.fn();
    renderRow({ onLocate });
    const locate = screen.getByRole("button", { name: `Locate ${event.title} on the map` });
    expect(locate).toHaveClass("relative", "z-10", "size-14", "hidden", "lg:flex");
    fireEvent.click(locate);
    expect(onLocate).toHaveBeenCalledWith(event.id, locate);
  });

  it("disables Locate, and says so, when the event has no place on the map", () => {
    renderRow({ hasLocation: false });
    expect(screen.getByRole("button", { name: `Locate ${event.title} on the map` })).toBeDisabled();
    expect(screen.getByText(/not shown on map/)).toBeInTheDocument();
  });

  it("says Selected in words, never colour alone", () => {
    renderRow({ selected: true });
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Locate ${event.title} on the map` })).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the proposal: mono date, title, venue and suburb, 'Category · km', then the all-inclusive 'From A$'", () => {
    // The sample has fixed dates, and an ended event has no ticket action: read it the day before.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(event.startsAt) - 24 * 3600_000));
    const { container } = render(
      <SceneEventRow
        event={event}
        selected={false}
        hasLocation
        onLocate={vi.fn()}
        distance="8.3 km"
        detailsHref={`/events/${event.slug}`}
      />,
    );
    const row = container.querySelector("[data-scene-row]") as HTMLElement;
    expect(row.querySelector(".meta")).toHaveTextContent(/^\w{3} \d{1,2} \w{3,4} · \d{1,2}:\d{2} [ap]m/);
    // The title is an h3 (under the list's h2), its link the row's one link; 24/32 from lg.
    expect(screen.getByRole("heading", { level: 3, name: event.title })).toHaveClass("heading-h4", "lg:heading-h3");
    expect(row.querySelector(".meta")).toHaveClass("lg:mono-m");
    expect(row.querySelector("[data-row-price]")).toHaveClass("text-right", "whitespace-nowrap");
    // Buy tickets only from lg, 48px.
    const buy = screen.getByRole("link", { name: /tickets for / });
    expect(buy.closest(".hidden")).toHaveClass("lg:block");
    expect(buy).toHaveClass("min-h-12");
    expect(row.querySelector("[data-place-lines]")).toHaveTextContent(event.venueName);
    expect(row).toHaveTextContent(/· 8\.3 km away/);
    // The card's price label: all-inclusive, in Australian dollars.
    expect(row.querySelector("[data-row-price]")?.textContent).toMatch(/^(From A\$[\d.,]+|Free|Free \+ paid|Sold out|Tickets coming soon)$/);
  });
});
