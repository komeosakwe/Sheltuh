// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventPreview, { PREVIEW_COUNT } from "@/components/EventPreview";
import { sampleEvents } from "@/lib/sample-events";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const soonest = [...sampleEvents].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

describe("EventPreview (demo mode)", () => {
  it("on a phone shows only the first few events, soonest first, with a link to the rest", async () => {
    stubViewport(true);
    render(<EventPreview />);
    expect(await screen.findByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
    expect(await screen.findAllByText(soonest[0].title)).toHaveLength(1);
    expect(screen.queryByText(soonest[PREVIEW_COUNT].title)).not.toBeInTheDocument();
    expect(sampleEvents.length).toBeGreaterThan(PREVIEW_COUNT);
  });

  it("on wider screens shows the full set for the drifting carousel", async () => {
    stubViewport(false);
    render(<EventPreview />);
    expect(await screen.findAllByText(soonest[PREVIEW_COUNT].title)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "See all events" })).toBeInTheDocument();
  });
});
