// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventArt from "@/components/EventArt";
import type { EventPoster } from "@/lib/types";

afterEach(cleanup);

const poster: EventPoster = { pattern: "burst", background: "#000", primary: "#f00", secondary: "#fff" };

describe("EventArt", () => {
  it("shows the generated poster art when there is no photo", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows the photo when there is one, and falls back to the poster art if it fails to load", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" imageUrl="/events/x.jpg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/events/x.jpg");

    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("is decorative: the title is always real text elsewhere, so the art is hidden from assistive tech", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" imageUrl="/events/x.jpg" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
