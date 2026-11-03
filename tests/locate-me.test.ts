// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GEOLOCATION_OPTIONS } from "@/lib/geolocation";
import { LOCATE_REFUSED_KEY, locateMe, rememberLocateRefused, wasLocateRefused } from "@/lib/locate-me";

type GetCurrentPosition = (
  success: PositionCallback,
  failure?: PositionErrorCallback | null,
  options?: PositionOptions,
) => void;
const getCurrentPosition = vi.fn<GetCurrentPosition>();

function stubGeolocation() {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
}

function reportPosition(latitude: number, longitude: number) {
  getCurrentPosition.mockImplementation((success) =>
    success({
      coords: {
        latitude,
        longitude,
        accuracy: 1000,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: 0,
      toJSON: () => ({}),
    }),
  );
}

afterEach(() => {
  getCurrentPosition.mockReset();
  Reflect.deleteProperty(navigator, "geolocation");
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("locateMe", () => {
  it("asks once, coarsely, and names the suburb the position is in", async () => {
    stubGeolocation();
    reportPosition(-37.8136, 144.9631);
    const result = await locateMe();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toBe(GEOLOCATION_OPTIONS);
    expect(GEOLOCATION_OPTIONS).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    expect(result).toMatchObject({ kind: "found", suburb: "Melbourne", state: "VIC", position: { lat: -37.8136, lng: 144.9631 } });
  });

  it("a position overseas is outside", async () => {
    stubGeolocation();
    reportPosition(51.5072, -0.1276);
    expect(await locateMe()).toEqual({ kind: "outside" });
  });

  it("tells denied from other failures", async () => {
    stubGeolocation();
    getCurrentPosition.mockImplementation((_success, failure) =>
      failure?.({ code: 1, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
    );
    expect(await locateMe()).toEqual({ kind: "denied" });
    getCurrentPosition.mockImplementation((_success, failure) =>
      failure?.({ code: 3, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
    );
    expect(await locateMe()).toEqual({ kind: "failed" });
  });

  it("fails without asking when the browser has no geolocation", async () => {
    expect(await locateMe()).toEqual({ kind: "failed" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe("the session's refusal", () => {
  it("is remembered in sessionStorage only", () => {
    expect(wasLocateRefused()).toBe(false);
    expect(rememberLocateRefused()).toBe(true);
    expect(wasLocateRefused()).toBe(true);
    expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1");
    expect(localStorage.getItem(LOCATE_REFUSED_KEY)).toBeNull();
  });

  it("doesn't throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(rememberLocateRefused()).toBe(false);
    expect(wasLocateRefused()).toBe(false);
  });
});
