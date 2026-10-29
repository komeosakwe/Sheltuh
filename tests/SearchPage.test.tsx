// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import EventFeed from "@/components/EventFeed";
import SearchBar from "@/components/SearchBar";
import { isUpcomingEvent } from "@/lib/data";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";
import { sampleEvents } from "@/lib/sample-events";

// The demo feed lists only events that haven't ended, so the sample data is read as of a fixed day.
const NOW = new Date("2026-09-30T02:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

type Params = Record<string, string | string[] | undefined>;

function findElement(node: unknown, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  if (node.type === type) return node;
  return findElement((node.props as { children?: unknown }).children, type);
}

async function page(searchParams: Params) {
  return SearchPage({ searchParams: Promise.resolve(searchParams) });
}

describe("/search?near= (owner round of 24 Oct 2026)", () => {
  it("passes a known suburb, found on the server, to the feed and the bar; the feed restarts when it changes", async () => {
    const tree = await page({ q: " jazz ", near: ["  st kilda ", "Fitzroy"] });
    const feed = findElement(tree, EventFeed);
    expect(feed?.props).toMatchObject({ query: "jazz", near: { name: "St Kilda", state: "VIC" } });
    expect(Object.keys((feed?.props as { near: object }).near).sort()).toEqual(["lat", "lng", "name", "state"]);
    expect(feed?.key).toBe("jazz|St Kilda");
    // The bar mirrors the address as typed, not the remembered suburb.
    expect(findElement(tree, SearchBar)?.props).toMatchObject({ near: "st kilda", defaultValue: "jazz", tone: "signal", size: "lg" });
  });

  it("cuts `near` at 60 characters and passes no suburb when there's none", async () => {
    expect(findElement(await page({ near: "x".repeat(80) }), SearchBar)?.props).toMatchObject({ near: "x".repeat(60), appliedNear: "x".repeat(60) });
    const tree = await page({ q: "jazz" });
    expect(findElement(tree, EventFeed)?.props).toMatchObject({ query: "jazz", near: undefined });
    // No `near` in the address: the bar may start from the remembered suburb; the results don't.
    expect(findElement(tree, SearchBar)?.props).toMatchObject({ near: undefined, appliedNear: "" });
  });

  it("without `near`: prefills the remembered suburb in the bar, keeps the results as they are, and says to press Search", async () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    render(await page({ q: "jazz" }));
    expect(screen.getByRole("button", { name: "Location: Brunswick" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("“jazz”");
    expect(document.querySelector("[data-near-hint]")).toHaveTextContent("Press Search to update results.");
    expect(screen.queryByText(/Closest to/)).toBeNull();
  });

  it("with `near`: the bar mirrors it (not the remembered suburb), with no hint until the location changes", async () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    render(await page({ near: "fitzroy" }));
    expect(screen.getByRole("button", { name: "Location: fitzroy" })).toBeInTheDocument();
    const hint = document.querySelector("[data-near-hint]");
    expect(hint).toHaveAttribute("aria-live", "polite");
    expect(hint).toHaveTextContent(/^$/);
    fireEvent.change(screen.getByLabelText("Suburb"), { target: { value: "Carlton" } });
    expect(hint).toHaveTextContent("Press Search to update results.");
    fireEvent.change(screen.getByLabelText("Suburb"), { target: { value: " Fitzroy " } });
    expect(hint).toHaveTextContent(/^$/);
  });

  it("drops an empty `near` from the address (a search sent before the bar's script ran, or without JS)", async () => {
    await expect(page({ q: "jazz", near: "" })).rejects.toMatchObject({ digest: expect.stringContaining(";/search?q=jazz;") });
    await expect(page({ near: "  " })).rejects.toMatchObject({ digest: expect.stringContaining(";/search;") });
  });

  it.each<[Params, string]>([
    [{}, "Find an event"],
    [{ q: "jazz" }, "“jazz”"],
    [{ near: "Fitzroy" }, "Events near Fitzroy"],
    [{ q: "jazz", near: "fitzroy" }, "“jazz” near Fitzroy"],
    [{ q: "jazz", near: "Atlantis" }, "“jazz”"],
    [{ near: "Richmond, NSW" }, "Events near Richmond NSW"],
    [{ near: "Perth" }, "Events near Perth"],
  ])("h1 for %j: %s", async (params, h1) => {
    render(await page(params));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(h1);
  });

  it("a short placeholder, “Search events”, which also names the field; location has its own", async () => {
    render(await page({}));
    const field = screen.getByRole("searchbox", { name: "Search events" });
    expect(field).toHaveAttribute("placeholder", "Search events");
    expect(field).toHaveClass("text-ellipsis");
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
  });

  it("an unknown suburb: a notice, a suggestion when one is close, and the usual results", async () => {
    render(await page({ q: "jazz", near: "Brunswik" }));
    const notice = screen.getByText(/Can’t place “Brunswik”, so these are soonest first\./);
    expect(within(notice).getByRole("link", { name: "Brunswick, VIC" })).toHaveAttribute("href", "/search?q=jazz&near=Brunswick");
    expect(within(notice).getByRole("link", { name: "Search all of Australia" })).toHaveAttribute("href", "/search?q=jazz");
    cleanup();
    render(await page({ near: "Atlantis" }));
    const atlantis = screen.getByText(/Can’t place “Atlantis”/);
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    expect(within(atlantis).getByRole("link", { name: "Search all of Australia" })).toHaveAttribute("href", "/search");
  });

  it("demo: lists every upcoming event in bands, nearest first, soonest within each", async () => {
    render(await page({ near: "Fitzroy" }));
    await screen.findByText(/Closest to Fitzroy, VIC first/);
    const bands = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const order = ["In Fitzroy, VIC", "Within 5 km", "5–15 km", "15–100 km", "Over 100 km", "Location not on file"];
    const bandIndexes = bands.map((b) => order.indexOf(b ?? ""));
    // Only band headings, each once, in the bands' order.
    expect(bandIndexes.every((i) => i >= 0)).toBe(true);
    expect(bandIndexes).toEqual([...bandIndexes].sort((a, b) => a - b));
    expect(new Set(bandIndexes).size).toBe(bandIndexes.length);
    expect(bands[0]).toBe("In Fitzroy, VIC");
    // Every sample suburb is in the table; the interstate samples (owner decision D11) are over 100 km away.
    expect(bands).not.toContain("Location not on file");
    expect(bands[bands.length - 1]).toBe("Over 100 km");
    const upcoming = sampleEvents.filter((e) => isUpcomingEvent(e, NOW));
    const listed = [...document.querySelectorAll<HTMLElement>("[data-near-band]")].map((band) => within(band).getByRole("list"));
    // No region landmark per band: the h2s are the structure.
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    const titles = listed.flatMap((l) => within(l).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim()));
    expect(titles).toHaveLength(upcoming.length);
    const fitzroy = within(listed[0]).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    const expected = upcoming
      .filter((e) => e.suburb === "Fitzroy")
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
      .map((e) => e.title);
    expect(fitzroy).toEqual(expected);
  });
});
