// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapLocate } from "@/components/map/useMapLocate";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock("@/lib/geolocation", () => ({ hasGeolocation: () => true }));
const locateMe = vi.fn();
vi.mock("@/lib/locate-me", () => ({
  locateMe: () => locateMe(),
  rememberLocateRefused: vi.fn(),
  wasLocateRefused: () => false,
}));

beforeEach(() => {
  track.mockReset();
  locateMe.mockReset();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const FOUND = { kind: "found", position: { lat: -37.8, lng: 144.98 }, suburb: "Fitzroy", state: "VIC" };

describe("map_near_me_used", () => {
  it("is sent once when the visitor presses Near me and it finds them", async () => {
    locateMe.mockResolvedValue(FOUND);
    const { result } = renderHook(() => useMapLocate(false));
    await act(async () => result.current.locate());
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("map_near_me_used", {});
  });

  it.each([{ kind: "denied" }, { kind: "failed" }, { kind: "outside" }])("is not sent when it fails (%o)", async (failure) => {
    locateMe.mockResolvedValue(failure);
    const { result } = renderHook(() => useMapLocate(false));
    await act(async () => result.current.locate());
    expect(track).not.toHaveBeenCalled();
  });

  it("is not sent when the map asks by itself on open, even when that finds them", async () => {
    locateMe.mockResolvedValue(FOUND);
    renderHook(() => useMapLocate(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(locateMe).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });
});
