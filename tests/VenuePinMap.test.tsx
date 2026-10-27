// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenuePinMapLeafletProps } from "@/components/dashboard/VenuePinMapLeaflet";
import VenuePinMap, { PAN_STEP_PX, PIN_MAX_ZOOM, PIN_ZOOM_EXACT, PIN_ZOOM_SUBURB } from "@/components/dashboard/VenuePinMap";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import { AUSTRALIA_BOUNDS, panByPixels } from "@/lib/geo";
import type { Coordinates } from "@/lib/types";

/**
 * "Check the pin" (owner decision A-D1, 27 Oct 2026): the organiser moves
 * our map under a fixed pin. Leaflet is stood in for (its props are shown
 * as data attributes, and "Drag to" stands in for a drag); the suburb table
 * is tests/test-utils/locationStub.ts, whose loads can be made to fail.
 */

const loader = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/location-loader", async () => {
  const { locationStub } = await import("./test-utils/locationStub");
  return {
    loadLocation: () => (loader.fail ? Promise.reject(new Error("offline")) : Promise.resolve(locationStub)),
    loadedLocation: () => (loader.fail ? null : locationStub),
  };
});

const drag = vi.hoisted(() => ({ to: { lat: 0, lng: 0 }, zoom: null as number | null }));
vi.mock("@/components/dashboard/VenuePinMapLeaflet", () => ({
  default: ({ centre, zoom, minZoom, maxZoom, onMove, wheelZoom }: VenuePinMapLeafletProps) => (
    <div
      data-testid="leaflet"
      data-lat={centre.lat}
      data-lng={centre.lng}
      data-zoom={zoom}
      data-min-zoom={minZoom}
      data-max-zoom={maxZoom}
      data-wheel-zoom={String(wheelZoom)}
    >
      <button type="button" onClick={() => onMove(drag.to, drag.zoom ?? zoom)}>
        Drag to
      </button>
    </div>
  ),
}));

let phone = false;

beforeEach(() => {
  phone = false;
  loader.fail = false;
  drag.zoom = null;
  window.matchMedia = ((query: string) => ({
    matches: query === PHONE_QUERY && phone,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

const FITZROY: Coordinates = { lat: -37.8, lng: 144.98 };

function renderPicker(props: Partial<Parameters<typeof VenuePinMap>[0]> = {}) {
  const onChange = vi.fn<(pin: Coordinates) => void>();
  const onCancel = vi.fn();
  render(
    <VenuePinMap initialCentre={FITZROY} suburbLabel="Fitzroy, VIC" onChange={onChange} onCancel={onCancel} {...props} />,
  );
  return { onChange, onCancel };
}

const mapBox = () => screen.getByRole("application", { name: "Venue pin" });
const leaflet = () => screen.findByTestId("leaflet");
const at = (el: HTMLElement) => ({ lat: Number(el.dataset.lat), lng: Number(el.dataset.lng), zoom: Number(el.dataset.zoom) });
const round6 = (n: number) => Number(n.toFixed(6));

describe("VenuePinMap inline (from sm)", () => {
  it("shows the map at the suburb's centre with its instructions, the keyboard alternative described", async () => {
    renderPicker();
    const map = mapBox();
    expect(map).toHaveAttribute("tabindex", "0");
    expect(map).toHaveAttribute("aria-roledescription", "map");
    expect(map).toHaveAccessibleDescription(/Drag it, or select the map and use the arrow keys\. Zoom with the \+ and − buttons or keys\./);
    // The instructions are on show, not only announced.
    expect(screen.getByText(/Move the map until the pin is on the venue’s entrance/)).toBeVisible();
    // About 320px tall, framed.
    expect(map.parentElement).toHaveClass("h-80");
    const stub = await leaflet();
    expect(at(stub)).toEqual({ ...FITZROY, zoom: PIN_ZOOM_SUBURB });
    // Inline, the wheel scrolls the page.
    expect(stub).toHaveAttribute("data-wheel-zoom", "false");
    expect(stub).toHaveAttribute("data-max-zoom", String(PIN_MAX_ZOOM));
    // No dialog, no button to open one.
    expect(screen.queryByRole("button", { name: "Check the pin" })).toBeNull();
  });

  it("opens at street level on the organiser's existing pin", async () => {
    const pin = { lat: -37.80412, lng: 144.98377 };
    renderPicker({ initialCentre: pin, pinned: true });
    expect(at(await leaflet())).toEqual({ ...pin, zoom: PIN_ZOOM_EXACT });
  });

  it("arrow keys move the map (and so the pin) and report each new pin, rounded to 6 places", async () => {
    const { onChange } = renderPicker();
    await leaflet();
    const map = mapBox();

    fireEvent.keyDown(map, { key: "ArrowRight" });
    const east = panByPixels(FITZROY, PIN_ZOOM_SUBURB, PAN_STEP_PX, 0);
    expect(onChange).toHaveBeenLastCalledWith({ lat: round6(east.lat), lng: round6(east.lng) });
    expect(Number(map.dataset.lng)).toBeCloseTo(east.lng, 9);
    expect(Number((await leaflet()).dataset.lng)).toBeCloseTo(east.lng, 9);

    fireEvent.keyDown(map, { key: "ArrowUp" });
    const north = panByPixels(east, PIN_ZOOM_SUBURB, 0, -PAN_STEP_PX);
    expect(north.lat).toBeGreaterThan(east.lat);
    expect(onChange).toHaveBeenLastCalledWith({ lat: round6(north.lat), lng: round6(north.lng) });

    fireEvent.keyDown(map, { key: "ArrowLeft" });
    fireEvent.keyDown(map, { key: "ArrowDown" });
    expect(Number(map.dataset.lat)).toBeCloseTo(FITZROY.lat, 9);
    expect(Number(map.dataset.lng)).toBeCloseTo(FITZROY.lng, 9);
    expect(onChange).toHaveBeenCalledTimes(4);

    // Shift moves three times as far.
    fireEvent.keyDown(map, { key: "ArrowRight", shiftKey: true });
    expect(Number(map.dataset.lng)).toBeCloseTo(panByPixels(FITZROY, PIN_ZOOM_SUBURB, PAN_STEP_PX * 3, 0).lng, 9);
  });

  it("+ and − (keys and buttons) zoom without moving the pin, and stop at the limits", async () => {
    const { onChange } = renderPicker({ initialCentre: FITZROY, pinned: true });
    await leaflet();
    const map = mapBox();
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    // Already at the basemap's closest.
    expect(zoomIn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(zoomIn);
    fireEvent.keyDown(map, { key: "+" });
    expect(map).toHaveAttribute("data-zoom", String(PIN_MAX_ZOOM));

    fireEvent.keyDown(map, { key: "-" });
    expect(map).toHaveAttribute("data-zoom", String(PIN_MAX_ZOOM - 1));
    expect(zoomIn).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(zoomOut);
    expect(map).toHaveAttribute("data-zoom", String(PIN_MAX_ZOOM - 2));
    fireEvent.keyDown(map, { key: "=" });
    expect(map).toHaveAttribute("data-zoom", String(PIN_MAX_ZOOM - 1));
    expect(Number((await leaflet()).dataset.zoom)).toBe(PIN_MAX_ZOOM - 1);
    // Zoom alone isn't a new pin.
    expect(onChange).not.toHaveBeenCalled();

    for (let i = 0; i < 20; i++) fireEvent.click(zoomOut);
    expect(map).toHaveAttribute("data-zoom", "5");
    expect(zoomOut).toHaveAttribute("aria-disabled", "true");
  });

  it("leaves other keys alone (Tab, and arrows with a modifier, and keys from the zoom buttons)", async () => {
    const { onChange } = renderPicker();
    await leaflet();
    const map = mapBox();
    for (const init of [{ key: "Tab" }, { key: "a" }, { key: "ArrowRight", altKey: true }, { key: "ArrowRight", metaKey: true }]) {
      expect(fireEvent.keyDown(map, init)).toBe(true);
    }
    fireEvent.keyDown(screen.getByRole("button", { name: "Zoom in" }), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    // A handled key doesn't scroll the page.
    expect(fireEvent.keyDown(map, { key: "ArrowDown" })).toBe(false);
  });

  it("reports a drag on the map, and never a pin outside Australia", async () => {
    const { onChange } = renderPicker();
    await leaflet();
    drag.to = { lat: -37.80123456, lng: 144.99123456 };
    fireEvent.click(screen.getByRole("button", { name: "Drag to" }));
    expect(onChange).toHaveBeenLastCalledWith({ lat: -37.801235, lng: 144.991235 });

    drag.to = { lat: -50, lng: 175 };
    fireEvent.click(screen.getByRole("button", { name: "Drag to" }));
    expect(onChange).toHaveBeenLastCalledWith({ lat: AUSTRALIA_BOUNDS.south, lng: AUSTRALIA_BOUNDS.east });

    // The map settling where it already is isn't a new pin.
    const calls = onChange.mock.calls.length;
    drag.to = { lat: AUSTRALIA_BOUNDS.south, lng: AUSTRALIA_BOUNDS.east };
    fireEvent.click(screen.getByRole("button", { name: "Drag to" }));
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("can't be moved past Australia's edge from the keyboard either", async () => {
    const { onChange } = renderPicker({ initialCentre: { lat: -8.05, lng: 169.95 } });
    await leaflet();
    const map = mapBox();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(map, { key: "ArrowRight", shiftKey: true });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(map, { key: "ArrowUp", shiftKey: true });
    expect(Number(map.dataset.lng)).toBe(AUSTRALIA_BOUNDS.east);
    expect(Number(map.dataset.lat)).toBe(AUSTRALIA_BOUNDS.north);
    for (const [pin] of onChange.mock.calls) {
      expect(pin.lng).toBeLessThanOrEqual(AUSTRALIA_BOUNDS.east);
      expect(pin.lat).toBeLessThanOrEqual(AUSTRALIA_BOUNDS.north);
    }
  });

  it("starts inside Australia even when given a centre outside it", async () => {
    renderPicker({ initialCentre: { lat: 0, lng: 0 } });
    expect(at(await leaflet())).toMatchObject({ lat: AUSTRALIA_BOUNDS.north, lng: AUSTRALIA_BOUNDS.west });
  });

  it("names the suburb nearest the pin in a live line, as the map moves", async () => {
    renderPicker();
    await leaflet();
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Nearest suburb: Fitzroy, VIC");
    // One step east (about 600 m at this zoom) is nearer Collingwood's centre.
    fireEvent.keyDown(mapBox(), { key: "ArrowRight" });
    expect(line).toHaveTextContent("Nearest suburb: Collingwood, VIC");
    drag.to = { lat: -40, lng: 150 };
    fireEvent.click(screen.getByRole("button", { name: "Drag to" }));
    expect(line).toHaveTextContent("The pin isn’t in an Australian suburb. Move it onto the venue.");
  });

  it("says so when the suburb list can't load, with a way to try again", async () => {
    loader.fail = true;
    renderPicker();
    expect(screen.getByRole("status")).toHaveTextContent("Finding the nearest suburb…");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("The suburb list couldn’t load, so the nearest suburb can’t be shown."),
    );
    loader.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nearest suburb: Fitzroy, VIC"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("VenuePinMap on phones: a full-screen dialog", () => {
  beforeEach(() => {
    phone = true;
  });

  it("is a button until opened, with no map on the page to trap scrolling", () => {
    renderPicker();
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.queryByTestId("leaflet")).toBeNull();
    const open = screen.getByRole("button", { name: "Check the pin" });
    expect(open).toHaveAttribute("aria-haspopup", "dialog");
    expect(open).toHaveClass("btn-lg");
    // The current pin's suburb, quietly (it changes only on Done).
    const summary = document.querySelector("[data-nearest-suburb]");
    expect(summary).toHaveTextContent("Nearest suburb: Fitzroy, VIC");
    expect(summary).not.toHaveAttribute("role");
  });

  it("opens full screen; moves stay in the dialog until Done, which saves the pin and returns focus", async () => {
    const { onChange, onCancel } = renderPicker();
    const open = screen.getByRole("button", { name: "Check the pin" });
    fireEvent.click(open);

    const dialog = screen.getByRole("dialog", { name: "Check the pin: Fitzroy, VIC" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("h-dvh", "w-full", "max-w-none");
    expect(dialog).toHaveAccessibleDescription(/Move the map until the pin is on the venue’s entrance/);
    expect(within(dialog).getByRole("heading", { name: "Check the pin: Fitzroy, VIC" })).toHaveFocus();
    const stub = await within(dialog).findByTestId("leaflet");
    // Full screen: the wheel and pinch zoom the map.
    expect(stub).toHaveAttribute("data-wheel-zoom", "true");

    const map = within(dialog).getByRole("application", { name: "Venue pin" });
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Nearest suburb: Collingwood, VIC");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    const east = panByPixels(FITZROY, PIN_ZOOM_SUBURB, PAN_STEP_PX, 0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ lat: round6(east.lat), lng: round6(east.lng) });
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.queryByTestId("leaflet")).toBeNull();
    expect(open).toHaveFocus();
    expect(document.querySelector("[data-nearest-suburb]")).toHaveTextContent("Nearest suburb: Collingwood, VIC");

    // Opened again, it's where it was left.
    fireEvent.click(open);
    expect(Number((await screen.findByTestId("leaflet")).dataset.lng)).toBeCloseTo(east.lng, 9);
  });

  it("Done without moving the map confirms the pin where it is", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Check the pin" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(FITZROY);
  });

  it("Cancel (and Escape) close without saving, and the pin stays as it was", async () => {
    const { onChange, onCancel } = renderPicker();
    const open = screen.getByRole("button", { name: "Check the pin" });
    fireEvent.click(open);
    await screen.findByTestId("leaflet");
    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(open).toHaveFocus();

    fireEvent.click(open);
    expect(at(await screen.findByTestId("leaflet"))).toEqual({ ...FITZROY, zoom: PIN_ZOOM_SUBURB });
    // Escape: the dialog's cancel event.
    const dialog = screen.getByRole("dialog");
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(dialog).not.toHaveAttribute("open");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("if the browser closes the dialog itself, that's a Cancel, and the button opens it again", async () => {
    const { onChange, onCancel } = renderPicker();
    const open = screen.getByRole("button", { name: "Check the pin" });
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog");
    act(() => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("leaflet")).toBeNull();
    fireEvent.click(open);
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(await screen.findByTestId("leaflet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    // Our own close after Done isn't a Cancel.
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("names the dialog plainly without a suburb", () => {
    renderPicker({ suburbLabel: " " });
    fireEvent.click(screen.getByRole("button", { name: "Check the pin" }));
    expect(screen.getByRole("dialog", { name: "Check the pin" })).toBeInTheDocument();
  });
});
