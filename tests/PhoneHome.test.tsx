// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhoneHome from "@/components/home/phone/PhoneHome";
import { sampleEvents } from "@/lib/sample-events";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T02:00:00.000Z"));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PhoneHome (demo data, 30 Sep 2026)", () => {
  it("reads as one outline: a single h1, then the sections in order", async () => {
    render(<PhoneHome />);
    await act(() => new Promise((r) => setTimeout(r, 0)));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Browse by category",
      "Up next",
      "Coming up in Melbourne",
      "What’s on in October",
      "Only in the city",
      "Free & low-cost",
      "Find your people",
      "Bring your event to life",
    ]);
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });

  it("features the soonest event that hasn't ended (demo data includes past events)", async () => {
    render(<PhoneHome />);
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const now = Date.now();
    const soonest = [...sampleEvents]
      .filter((e) => Date.parse(e.endsAt ?? e.startsAt) >= now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent(soonest.title);
    expect(screen.queryByText("Neon Static")).not.toBeInTheDocument();
  });

  it("never shows a heart or a saved control (there's no such feature)", async () => {
    render(<PhoneHome />);
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.queryByRole("button", { name: /save|favourite|heart/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /saved/i })).not.toBeInTheDocument();
  });
});
