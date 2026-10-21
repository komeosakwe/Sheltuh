// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RevealObserver from "@/components/RevealObserver";

/*
 * The scroll entrances (components/RevealObserver.tsx). jsdom has no layout
 * and no IntersectionObserver, so a fake one records what's observed and
 * lets a test say when something scrolls into view. jsdom's zero-size rects
 * put every element "off screen" (bottom 0) unless a test says otherwise.
 */

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
  /** Scrolls `element` into view, as the browser would report it. */
  enter(element: Element) {
    const entry = { target: element, isIntersecting: true } as unknown as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

const live = () => FakeIntersectionObserver.instances.filter((observer) => !observer.disconnected);

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })),
  );
}

/** Off-screen content the observer will arm: a lone `data-reveal` block and a staggered grid. */
function mountContent() {
  document.body.innerHTML = `
    <section data-reveal id="block"><a href="#x" id="block-link">Read more</a></section>
    <ul data-reveal-stagger id="grid"><li id="a"><a href="#a">A</a></li><li id="b">B</li><li id="c">C</li></ul>
  `;
  return {
    block: document.getElementById("block") as HTMLElement,
    link: document.getElementById("block-link") as HTMLAnchorElement,
    a: document.getElementById("a") as HTMLElement,
    b: document.getElementById("b") as HTMLElement,
  };
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  stubMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function renderObserver(strict = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return render(strict ? <StrictMode><RevealObserver /></StrictMode> : <RevealObserver />, { container });
}

describe("RevealObserver", () => {
  it("arms off-screen content, staggers a grid's children, and reveals each as it scrolls in", () => {
    const { block, a, b } = mountContent();
    renderObserver();

    const [observer] = live();
    for (const element of [block, a, b]) {
      expect(element).toHaveClass("reveal-pending");
      expect(element).toHaveAttribute("data-reveal-armed");
      expect(observer.observed.has(element)).toBe(true);
    }
    expect(a.style.getPropertyValue("--reveal-d")).toBe("0ms");
    expect(b.style.getPropertyValue("--reveal-d")).toBe("60ms");

    act(() => observer.enter(a));
    expect(a).toHaveClass("is-revealed");
    expect(observer.observed.has(a)).toBe(false);
  });

  it("leaves what's already on screen at first load alone", () => {
    const { block } = mountContent();
    block.getBoundingClientRect = () => ({ top: 10, bottom: 200 }) as DOMRect;
    renderObserver();
    expect(block).not.toHaveClass("reveal-pending");
  });

  it("survives StrictMode's mount, unmount and mount: everything waiting is observed by the live observer", () => {
    const { block, a, b } = mountContent();
    renderObserver(true);

    // The first run's observer was disconnected by its cleanup; exactly one is live.
    expect(FakeIntersectionObserver.instances.length).toBeGreaterThanOrEqual(2);
    const observers = live();
    expect(observers).toHaveLength(1);
    const [observer] = observers;
    for (const element of [block, a, b]) {
      expect(element).toHaveClass("reveal-pending");
      expect(observer.observed.has(element)).toBe(true);
    }
    act(() => observer.enter(block));
    expect(block).toHaveClass("is-revealed");
  });

  it("un-arms whatever is still waiting when it unmounts, so nothing is left hidden", () => {
    const { block, a } = mountContent();
    const { unmount } = renderObserver();
    act(() => live()[0].enter(a));
    unmount();

    expect(block).not.toHaveClass("reveal-pending");
    expect(block).not.toHaveAttribute("data-reveal-armed");
    expect(block.style.getPropertyValue("--reveal-d")).toBe("");
    // Already revealed: stays revealed.
    expect(a).toHaveClass("reveal-pending", "is-revealed");
  });

  it("shows waiting content at once when keyboard focus lands inside it", () => {
    const { block, link } = mountContent();
    renderObserver();
    const [observer] = live();
    expect(block).toHaveClass("reveal-pending");

    act(() => link.focus());
    expect(block).not.toHaveClass("reveal-pending");
    expect(observer.observed.has(block)).toBe(false);
    // Still marked armed, so later scans don't hide it again.
    expect(block).toHaveAttribute("data-reveal-armed");
  });

  it("arms content that arrives later (a feed's results)", async () => {
    renderObserver();
    const list = document.createElement("ul");
    list.setAttribute("data-reveal-stagger", "");
    list.innerHTML = "<li>Late</li>";
    document.body.appendChild(list);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(list.firstElementChild).toHaveClass("reveal-pending");
  });

  it("does nothing for people who prefer reduced motion", () => {
    stubMotion(true);
    const { block } = mountContent();
    renderObserver();
    expect(block).not.toHaveClass("reveal-pending");
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });
});
