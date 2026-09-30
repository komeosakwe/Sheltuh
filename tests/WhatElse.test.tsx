// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WhatElse } from "@/components/HomeSections";

afterEach(cleanup);

/** The poster layers are the aria-hidden panel's children; the visible one has opacity-100. */
function visibleLayerIndex(container: HTMLElement) {
  const layers = Array.from(container.querySelectorAll('[aria-hidden="true"] > div'));
  return layers.findIndex((layer) => layer.className.includes("opacity-100"));
}

describe("WhatElse", () => {
  it("highlights the pointed-at line and swaps the poster to match", () => {
    const { container } = render(<WhatElse />);
    expect(visibleLayerIndex(container)).toBe(0);

    fireEvent.mouseEnter(screen.getByText("The price you see is the price you pay").closest("li")!);
    expect(visibleLayerIndex(container)).toBe(1);
    expect(screen.getByText("The price you see is the price you pay").closest("li")).toHaveClass("opacity-100");
    expect(screen.getByText("Every event reviewed by a person").closest("li")).toHaveClass("opacity-35");

    fireEvent.click(screen.getByText("Free events stay free").closest("li")!);
    expect(visibleLayerIndex(container)).toBe(2);
  });
});
