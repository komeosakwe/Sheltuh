// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneEventRow from "@/components/SceneEventRow";
import { sampleEvents } from "@/lib/sample-events";

/*
 * The map list row (mobile polish, 29 Oct 2026): like an event card, the whole row opens the
 * event (the title's link stretches over it), with Locate and the ticket action above it.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

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

  it("keeps Locate above the link, at least 44px, and calls back with the button", () => {
    const onLocate = vi.fn();
    renderRow({ onLocate });
    const locate = screen.getByRole("button", { name: `Locate ${event.title} on the map` });
    expect(locate).toHaveClass("relative", "z-10", "size-11");
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
});
