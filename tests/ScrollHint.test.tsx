// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ScrollHint, { ScrollEdges } from "@/components/ui/ScrollHint";

/*
 * The cue that a sideways row scrolls (mobile polish, 29 Oct 2026): a fade on each side with more
 * beyond it and, on phones, an arrow at the right edge. Decorative, and only while the row
 * overflows. jsdom has no layout, so the scroller gets fake metrics.
 */

afterEach(cleanup);

function setMetrics(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
  act(() => void fireEvent.scroll(el));
}

const fade = (c: HTMLElement, side: "start" | "end") => c.querySelector(`[data-scroll-fade="${side}"]`);
const arrow = (c: HTMLElement) => c.querySelector("[data-scroll-arrow]");

describe("ScrollEdges", () => {
  it("shows nothing when the row neither scrolls back nor on", () => {
    const { container } = render(<ScrollEdges canPrev={false} canNext={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fades the start only when there is more behind, the end and the arrow only when there is more ahead", () => {
    const { container, rerender } = render(<ScrollEdges canPrev canNext={false} />);
    expect(fade(container, "start")).toBeInTheDocument();
    expect(fade(container, "end")).toBeNull();
    expect(arrow(container)).toBeNull();
    rerender(<ScrollEdges canPrev={false} canNext />);
    expect(fade(container, "start")).toBeNull();
    expect(fade(container, "end")).toBeInTheDocument();
    expect(arrow(container)).toBeInTheDocument();
  });

  it("is decorative: hidden from assistive tech and never takes a tap; the arrow is for phones only", () => {
    const { container } = render(<ScrollEdges canPrev canNext />);
    for (const el of [fade(container, "start"), fade(container, "end"), arrow(container)]) {
      expect(el).toHaveAttribute("aria-hidden", "true");
      expect(el).toHaveClass("pointer-events-none");
    }
    expect(arrow(container)).toHaveClass("sm:hidden");
  });
});

describe("ScrollHint", () => {
  function renderRow() {
    const view = render(
      <ScrollHint className="-mx-5">
        <div data-testid="row">
          <a href="#a">A</a>
        </div>
      </ScrollHint>,
    );
    return { ...view, row: view.getByTestId("row") };
  }

  it("keeps the frame's class and the scroller inside it", () => {
    const { container, row } = renderRow();
    expect(container.firstElementChild).toHaveClass("relative", "-mx-5");
    expect(container.firstElementChild).toContainElement(row);
  });

  it("shows no cue while the row fits", () => {
    const { container, row } = renderRow();
    setMetrics(row, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    expect(fade(container, "start")).toBeNull();
    expect(fade(container, "end")).toBeNull();
    expect(arrow(container)).toBeNull();
  });

  it("at the start of an overflowing row: the end fade and arrow only", () => {
    const { container, row } = renderRow();
    setMetrics(row, { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 });
    expect(fade(container, "start")).toBeNull();
    expect(fade(container, "end")).toBeInTheDocument();
    expect(arrow(container)).toBeInTheDocument();
  });

  it("in the middle: both fades; at the end: the start fade only", () => {
    const { container, row } = renderRow();
    setMetrics(row, { scrollWidth: 900, clientWidth: 300, scrollLeft: 200 });
    expect(fade(container, "start")).toBeInTheDocument();
    expect(fade(container, "end")).toBeInTheDocument();
    setMetrics(row, { scrollWidth: 900, clientWidth: 300, scrollLeft: 600 });
    expect(fade(container, "start")).toBeInTheDocument();
    expect(fade(container, "end")).toBeNull();
    expect(arrow(container)).toBeNull();
  });
});
