// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventPreview, { PREVIEW_COUNT } from "@/components/EventPreview";
import { sampleEvents } from "@/lib/sample-events";

afterEach(cleanup);

describe("EventPreview (demo mode)", () => {
  it("shows only the first few events, soonest first, with a link to the rest", async () => {
    render(<EventPreview />);
    const link = await screen.findByRole("link", { name: "See all events" });
    expect(link).toHaveAttribute("href", "/events");

    const soonest = [...sampleEvents].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(await screen.findAllByText(soonest[0].title)).toHaveLength(1);
    expect(screen.queryByText(soonest[PREVIEW_COUNT].title)).not.toBeInTheDocument();
    expect(sampleEvents.length).toBeGreaterThan(PREVIEW_COUNT);
  });
});
