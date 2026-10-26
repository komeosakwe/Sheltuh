// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NearbyResults from "@/components/search/NearbyResults";
import * as location from "@/lib/location";
import type { LocationModule } from "@/lib/location-loader";
import { sampleEvents } from "@/lib/sample-events";

// The suburb table is loaded on demand: here the load is under the test's control.
const loadLocation = vi.fn<() => Promise<LocationModule>>();
vi.mock("@/lib/location-loader", () => ({
  loadLocation: () => loadLocation(),
  loadedLocation: () => null,
}));

const FITZROY = location.findLocality("Fitzroy");
if (!FITZROY) throw new Error("Fitzroy is not in the suburb table");
const events = sampleEvents.slice(0, 4);

beforeEach(() => loadLocation.mockReset());
afterEach(cleanup);

describe("NearbyResults — the suburb table loads on demand", () => {
  it("says it's sorting while the table loads, then shows the bands", async () => {
    let resolve: (module: LocationModule) => void = () => {};
    loadLocation.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<NearbyResults events={events} origin={FITZROY} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sorting by distance from Fitzroy…");
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    resolve(location);
    await screen.findByText(/Closest to Fitzroy first/);
    expect(document.querySelectorAll("[data-near-band]").length).toBeGreaterThan(0);
  });

  it("if it can't load: says so, still lists every event (soonest first), and Try again retries", async () => {
    loadLocation.mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce(location);
    render(<NearbyResults events={events} origin={FITZROY} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t sort these by distance from Fitzroy, so they’re soonest first.");
    const list = screen.getByRole("list", { name: "Events" });
    expect(within(list).getAllByRole("heading", { level: 3 })).toHaveLength(events.length);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/Closest to Fitzroy first/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadLocation).toHaveBeenCalledTimes(2);
  });
});
