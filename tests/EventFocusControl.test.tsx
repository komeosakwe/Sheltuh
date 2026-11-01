// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventFocusControl from "@/components/dashboard/EventFocusControl";
import { EventMarkerMark } from "@/components/map/MapEventMarker";
import type { EventPoster, SheltuhEvent } from "@/lib/types";

afterEach(cleanup);

const poster: EventPoster = { pattern: "burst", background: "#000", primary: "#f00", secondary: "#fff" };

function setup(focus: { x: number; y: number } | null = null) {
  const onChange = vi.fn();
  const view = render(<EventFocusControl imageUrl="blob:photo" focus={focus} onChange={onChange} poster={poster} title="Neon" />);
  const slider = screen.getByRole("slider", { name: "Focus" });
  // jsdom has no layout: a 200 x 100 photo at the origin.
  slider.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  return { onChange, slider, ...view };
}

describe("EventFocusControl", () => {
  it("is labelled, hints in a few words, and starts in the middle", () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute("aria-valuetext", "50% across, 50% down");
    expect(screen.getByText("Tap the main subject")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Centre" })).toBeNull();
  });

  it("places the focus where the photo is pressed, and follows a drag", () => {
    const { slider, onChange } = setup();
    fireEvent.pointerDown(slider, { clientX: 50, clientY: 25, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ x: 25, y: 25 });
    // Moves count only while the pointer is held (captured).
    fireEvent.pointerMove(slider, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    slider.hasPointerCapture = () => true;
    fireEvent.pointerMove(slider, { clientX: 150, clientY: 75, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ x: 75, y: 75 });
    // Outside the photo clamps to its edge.
    fireEvent.pointerMove(slider, { clientX: 999, clientY: -40, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ x: 100, y: 0 });
  });

  it("moves 5% per arrow key from the current point (or the middle), stopping at the edges", () => {
    const { slider, onChange } = setup({ x: 98, y: 3 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 100, y: 3 });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 98, y: 0 });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 93, y: 3 });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 98, y: 8 });
    fireEvent.keyDown(slider, { key: "a" });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("starts from the middle for the first key press", () => {
    const { slider, onChange } = setup();
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 55 });
  });

  it("puts the focus back in the middle with Home or the Centre button", () => {
    const { slider, onChange } = setup({ x: 10, y: 20 });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Centre" }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("shows the marker and both crop previews at the focus point", () => {
    const { container } = setup({ x: 30, y: 60 });
    expect((container.querySelector("[data-focus-marker]") as HTMLElement).style.left).toBe("30%");
    const crops = Array.from(container.querySelectorAll("img")).filter((img) => img.style.objectPosition);
    expect(crops).toHaveLength(2);
    for (const img of crops) expect(img.style.objectPosition).toBe("30% 60%");
    expect(screen.getByText("Pin")).toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument();
  });
});

describe("map marker", () => {
  it("crops the pin's photo on the event's focus point", () => {
    const event: Pick<SheltuhEvent, "poster" | "title" | "imageUrl" | "imageFocus"> = {
      poster,
      title: "Neon",
      imageUrl: "/api/events/e/image?v=1",
      imageFocus: { x: 15, y: 40 },
    };
    const { container } = render(<EventMarkerMark event={event} />);
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("15% 40%");
  });
});
