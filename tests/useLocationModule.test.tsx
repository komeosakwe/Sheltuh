// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationModule } from "@/lib/location-loader";

/*
 * CodeRabbit (PR 43): after this hook's own load failed, another component (Where's menu, say) can
 * load the suburb table. The hook then has the table, so it mustn't still say it failed: Scenes by
 * city showed event counts beside "Event counts aren't available right now".
 */

let loaded: LocationModule | null = null;
const loadLocation = vi.fn<() => Promise<LocationModule>>();
vi.mock("@/lib/location-loader", () => ({
  loadLocation: () => loadLocation(),
  loadedLocation: () => loaded,
}));

const { useLocationModule } = await import("@/components/search/useLocationModule");
const location = await import("@/lib/location");

afterEach(() => {
  cleanup();
  loaded = null;
  loadLocation.mockReset();
});

describe("useLocationModule", () => {
  it("says it failed only while there's no table: one loaded elsewhere since clears it", async () => {
    loadLocation.mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderHook(() => useLocationModule());
    await act(async () => {});
    expect(result.current).toMatchObject({ module: null, failed: true });

    // Loaded by another component meanwhile.
    loaded = location;
    rerender();
    expect(result.current.module).toBe(location);
    expect(result.current.failed).toBe(false);
  });

  it("a load of its own: the table, and no failure", async () => {
    loadLocation.mockResolvedValue(location);
    const { result } = renderHook(() => useLocationModule());
    await act(async () => {});
    expect(result.current.module).toBe(location);
    expect(result.current.failed).toBe(false);
  });
});
