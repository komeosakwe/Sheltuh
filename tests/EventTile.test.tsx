// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventTile from "@/components/ui/EventTile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

afterEach(cleanup);

const liveEvent: SheltuhEvent = {
  ...sampleEvents[0],
  organiserId: "org-1",
  organiserName: "Northside Noise",
};

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

  it("has no organiser link for a demo event (no organiserId) or with showOrganiser={false}", () => {
    render(<EventTile event={sampleEvents[0]} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
    cleanup();
    render(<EventTile event={liveEvent} showOrganiser={false} />);
    expect(screen.queryByRole("link", { name: /^By / })).not.toBeInTheDocument();
  });
});
