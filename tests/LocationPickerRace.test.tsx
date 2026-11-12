// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";
import type { LocationModule } from "@/lib/location-loader";

/*
 * CodeRabbit (PR 43): a place chosen while the suburb table is still loading is set when the table
 * lands. A later action (All of Australia) must win: the earlier choice is dropped, not stored over it.
 * The loader is held here, so the table is pending for as long as each test needs.
 */

let release: ((module: LocationModule) => void) | null = null;
vi.mock("@/lib/location-loader", () => ({
  loadLocation: () =>
    new Promise<LocationModule>((resolve) => {
      release = resolve;
    }),
  loadedLocation: () => null,
}));

const { default: LocationPicker } = await import("@/components/search/LocationPicker");
const location = await import("@/lib/location");

function openPanel() {
  const panel = document.querySelector<HTMLElement>("[data-location-panel]");
  if (!panel) throw new Error("location panel not rendered");
  act(() => {
    panel.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open", oldState: "closed" }));
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open", oldState: "closed" }));
  });
  return panel;
}

afterEach(() => {
  cleanup();
  release = null;
  localStorage.clear();
});

describe("LocationPicker — a newer location action wins", () => {
  it("a Suggested place still loading when All of Australia is pressed isn't stored after it", async () => {
    render(<LocationPicker standalone />);
    const panel = openPanel();
    Object.assign(panel, { hidePopover: vi.fn() });
    fireEvent.click(within(panel).getByRole("button", { name: /Melbourne/, hidden: true }));
    const loadForChoice = release;
    fireEvent.click(within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();

    await act(async () => {
      loadForChoice?.(location);
      await Promise.resolve();
    });
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Location cleared: all of Australia");
  });

  it("the later of two places is the one kept, whichever loads last", async () => {
    render(<LocationPicker standalone />);
    const panel = openPanel();
    Object.assign(panel, { hidePopover: vi.fn() });
    fireEvent.click(within(panel).getByRole("button", { name: /Melbourne/, hidden: true }));
    const first = release;
    fireEvent.click(within(panel).getByRole("button", { name: /Perth/, hidden: true }));
    const second = release;
    await act(async () => {
      second?.(location);
      await Promise.resolve();
    });
    await act(async () => {
      first?.(location);
      await Promise.resolve();
    });
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toMatchObject({ suburb: "Perth", state: "WA" });
    expect(screen.getByRole("button", { name: "Where: Perth" })).toBeInTheDocument();
  });

  it("a place saved elsewhere (another tab) while a Suggested place is still loading wins: the stale one isn't stored", async () => {
    render(<LocationPicker standalone />);
    const panel = openPanel();
    Object.assign(panel, { hidePopover: vi.fn() });
    fireEvent.click(within(panel).getByRole("button", { name: /Melbourne/, hidden: true }));
    const pending = release;
    // Another tab saves Perth.
    act(() => {
      localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Perth", state: "WA" }));
      window.dispatchEvent(new StorageEvent("storage", { key: NEAR_STORAGE_KEY }));
    });
    expect(screen.getByRole("button", { name: "Where: Perth" })).toBeInTheDocument();
    await act(async () => {
      pending?.(location);
      await Promise.resolve();
    });
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toMatchObject({ suburb: "Perth", state: "WA" });
    expect(screen.getByRole("button", { name: "Where: Perth" })).toBeInTheDocument();
  });
});
