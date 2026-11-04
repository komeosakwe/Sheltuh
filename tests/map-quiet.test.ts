// @vitest-environment jsdom
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopQuietly } from "@/components/map/quiet-map";

/**
 * stopQuietly cuts a map's flight short (a centre request, a filter change). Leaflet's own
 * `map.stop()` ends by snapping a part-way zoom to a whole one with an *animated* setZoom, which
 * it starts on the next frame and finishes 250 ms later by restoring the zoom and centre it was
 * called at, over whatever the map was set to in between. A centre request made in the same tick
 * (components/SceneMapPanel.tsx) was undone whenever the flight had got part-way, which depends on
 * timing alone.
 */
/** Past Leaflet's next frame and the 250 ms it gives a zoom animation (real time: Leaflet reads the frame clock once, on load). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

describe("stopQuietly", () => {
  let host: HTMLDivElement;
  let map: L.Map;

  beforeEach(() => {
    host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 600 });
    Object.defineProperty(host, "clientHeight", { value: 400 });
    document.body.appendChild(host);
    map = L.map(host, { zoomAnimation: true, center: [-27.15, 133.3], zoom: 4 });
    // jsdom has no CSS 3D transforms, so Leaflet wouldn't animate a zoom here; a browser does.
    (map as unknown as { _zoomAnimated: boolean })._zoomAnimated = true;
    // Leaflet only animates a zoom when something on the map would move with it.
    L.circleMarker([-37.8, 144.9]).addTo(map);
    host.querySelector("svg")?.classList.add("leaflet-zoom-animated");
  });

  afterEach(() => {
    map.remove();
    host.remove();
  });

  /** A map part-way through a flight: Leaflet moves it by `_move`, to a zoom between whole numbers. */
  function partWay() {
    (map as unknown as { _move(centre: L.LatLng, zoom: number): void })._move(L.latLng(-30, 136), 4.3);
    expect(Number.isInteger(map.getZoom())).toBe(false);
  }

  it("leaves a view set straight after it in place, even when the zoom was part-way", async () => {
    const ref = { current: false };
    partWay();

    stopQuietly(map, ref);
    map.setView([-37.814, 144.963], 13, { animate: false });
    await settle();

    expect(map.getZoom()).toBe(13);
    expect(map.getCenter().lat).toBeCloseTo(-37.814, 3);
    expect(map.getCenter().lng).toBeCloseTo(144.963, 3);
  });

  it("still ends the flight at a whole zoom, without calling it a user move", async () => {
    const ref = { current: false };
    partWay();
    const moves = vi.fn();
    map.on("moveend", () => moves(ref.current));

    stopQuietly(map, ref);
    await settle();

    expect(Number.isInteger(map.getZoom())).toBe(true);
    expect(map.getZoom()).toBe(4);
    // One, as Leaflet's own stop() fires: the map's "Search this area" counts one quiet moveend per programmatic move.
    expect(moves).toHaveBeenCalledTimes(1);
    expect(moves.mock.calls.every(([quiet]) => quiet === true)).toBe(true);
    expect(ref.current).toBe(false);
  });
});
