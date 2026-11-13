// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunityPage from "@/components/community/CommunityPage";
import { COMMUNITY_LEDE, JOIN_FEATURES, JOIN_LEDE, LOCAL_DISCOVERY } from "@/components/community/community-content";
import { cityScenes } from "@/lib/community";
import { getUpcomingEvents } from "@/lib/data";
import { bySoonest } from "@/lib/home-sections";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/** /community in demo mode (no API: the sample events). Live mode: tests/CommunityPageLive.test.tsx. */

// Wed 21 Oct 2026, 12:00 AEDT.
const NOW = new Date("2026-10-21T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

async function renderPage(status: "signed-out" | "signed-in" = "signed-out") {
  const utils = render(
    <FakeAuthProvider value={fakeAuthValue(status === "signed-out" ? { status, email: undefined } : {})}>
      <CommunityPage />
    </FakeAuthProvider>,
  );
  await settle();
  return utils;
}

describe("/community (demo)", () => {
  it("makes no API request at all: the sample events only", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await renderPage();
      expect(screen.getByRole("list", { name: LOCAL_DISCOVERY.title })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads as one outline: the h1 FIND YOÜR PEOPLE. (read 'Find your people.'), then the real sections only", async () => {
    await renderPage();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Find your people.");
    expect(h1.querySelector("[aria-hidden='true']")?.textContent).toBe("Find yoür people.");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Local discovery",
      "Your visibility, your choice",
      "Scenes by city",
      "Find your people.",
    ]);
    // Concept-only parts wait for Batch 3: no Word of mouth, Follow scenes, member counts or "you know".
    expect(document.body).not.toHaveTextContent(/Word of mouth|Follow scenes|members|you know|saved this/i);
  });

  it("the hero: the proposal's lede, Explore scenes (a plain in-page link to Scenes by city) and Join free, over two rows of licensed photos, each once", async () => {
    const { container } = await renderPage();
    expect(screen.getByText(COMMUNITY_LEDE)).toBeInTheDocument();
    expect(COMMUNITY_LEDE).toBe("The people and creative scenes behind the events — across music, art, fashion and culture.");
    const explore = screen.getByRole("link", { name: "Explore scenes" });
    expect(explore).toHaveAttribute("href", "#scenes-by-city");
    expect(explore).toHaveClass("btn-signal");
    // A plain anchor, not a client-side navigation: the browser moves focus to the section.
    expect(explore.tagName).toBe("A");
    expect(screen.getByRole("link", { name: "Join free" })).toHaveAttribute("href", "/signup");
    expect(container.querySelector("#scenes-by-city")).toHaveAttribute("tabindex", "-1");
    const collage = container.querySelector("[data-community-collage]");
    expect(collage).toHaveAttribute("aria-hidden", "true");
    const srcs = Array.from(collage?.querySelectorAll("img") ?? []).map((img) => decodeURIComponent(img.getAttribute("src") ?? ""));
    expect(srcs.length).toBeGreaterThan(8);
    // Each photo once (the audit flagged repeats), in two rows.
    expect(new Set(srcs).size).toBe(srcs.length);
    expect(collage?.children).toHaveLength(2);
    // Only the licensed photos (public/events, public/home/people), never the proposal's.
    for (const src of srcs) expect(src).toMatch(/\/(events\/[a-z-]+\.(jpg|webp)|home\/people\/person-\d\.webp)/);
    for (const img of collage?.querySelectorAll("img") ?? []) expect(img).toHaveAttribute("alt", "");
  });

  it("Local discovery: its line, the soonest upcoming events as the one EventCard, and See events on Nearby", async () => {
    await renderPage();
    const section = screen.getByRole("region", { name: LOCAL_DISCOVERY.title });
    expect(within(section).getByText(LOCAL_DISCOVERY.body)).toBeInTheDocument();
    const upcoming = await getUpcomingEvents(NOW);
    const titles = within(within(section).getByRole("list", { name: LOCAL_DISCOVERY.title })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // The soonest six, in order (no remembered place, so no state goes first).
    expect(titles).toEqual([...upcoming].sort(bySoonest).slice(0, 6).map((e) => e.title));
    expect(titles).toHaveLength(Math.min(6, upcoming.length));
    expect(within(section).getByRole("link", { name: "See events on Nearby" })).toHaveAttribute("href", "/map");
  });

  it("Your visibility, your choice (owner's newer card): its line, three points and How Who's going works (text only: no toggle, no count)", async () => {
    await renderPage();
    const section = screen.getByRole("region", { name: "Your visibility, your choice" });
    expect(within(section).getByText("Who’s going is opt-in for each event.")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Choose when to appear",
      "Browse without joining the list",
      "Message eligible attendees when available",
    ]);
    expect(within(section).getByRole("link", { name: "How Who’s going works" })).toHaveAttribute("href", "/privacy#whos-going");
    expect(within(section).queryByRole("switch")).toBeNull();
    expect(within(section).queryByRole("checkbox")).toBeNull();
    expect(section).not.toHaveTextContent(/going ·|\d+ going/);
  });

  it("Scenes by city: each city links to Nearby around it (never changing the saved place), named for it, with its real categories and count", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    await renderPage();
    const section = screen.getByRole("region", { name: "Scenes by city" });
    const links = within(section).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("data-city"))).toEqual(["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide"]);
    for (const link of links) {
      const city = link.getAttribute("data-city") ?? "";
      expect(link).toHaveAttribute("href", `/map?near=${city}`);
      expect(link).toHaveAccessibleName(`Events near ${city} on Nearby`);
    }
    const { scenes, allPlaced } = cityScenes(await getUpcomingEvents(NOW), (e) => e.coordinates ?? null);
    expect(allPlaced).toBe(true);
    scenes.forEach((scene, i) => {
      const n = scene.events.length;
      expect(links[i]).toHaveTextContent(n > 0 ? `${n} upcoming` : "No upcoming events");
      for (const category of scene.categories) expect(links[i]).toHaveTextContent(category);
    });
    expect(scenes[0].events.length).toBeGreaterThan(0);
    // The count line is the link's description.
    expect(links[0]).toHaveAccessibleDescription(/\d+ upcoming/);
    links[1].addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(links[1]);
    expect(JSON.parse(localStorage.getItem("sheltuh:near:v1") ?? "{}")).toEqual({ suburb: "Fitzroy", state: "VIC" });
  });

  it("the join banner (owner's newer version): orange, Community, Find your people., its line, the two features, Join Sheltüh — free and Sign in", async () => {
    const { container } = await renderPage();
    const banner = joinBanner();
    expect(banner).toHaveAttribute("data-surface", "signal");
    expect(banner).toHaveTextContent(/^Community/);
    expect(within(banner).getByText(JOIN_LEDE)).toBeInTheDocument();
    expect(JOIN_LEDE).toBe("Discover creative events and choose how you connect.");
    expect(within(banner).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(JOIN_FEATURES.map((f) => f.title));
    expect(JOIN_FEATURES.map((f) => [f.title, f.body])).toEqual([
      ["See who’s going", "See attendees who choose to appear."],
      ["Your visibility, your choice", "Choose whether you appear on each event’s attendee list."],
    ]);
    expect(within(banner).getByText(/^Already a member\?/)).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    const join = within(banner).getByRole("link", { name: "Join Sheltüh — free" });
    expect(join).toHaveAttribute("href", "/signup");
    expect(join).toHaveClass("btn-solid");
    expect(banner).not.toHaveTextContent(/Email or Google/i);
    expect(banner.querySelector(".btn-signal")).toBeNull();
    // At most one orange band on the page.
    expect(container.querySelectorAll("[data-surface='signal']")).toHaveLength(1);
  });

  it("signed in: no Join free, and the banner's action finds an event", async () => {
    await renderPage("signed-in");
    expect(screen.queryByRole("link", { name: "Join free" })).toBeNull();
    const banner = joinBanner();
    expect(within(banner).getByRole("link", { name: "Find an event" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Join Sheltüh — free" })).toBeNull();
    expect(within(banner).queryByText(/Already a member/)).toBeNull();
  });
});

/** The join banner (its title, "Find your people.", is also the page's h1). */
function joinBanner(): HTMLElement {
  const banner = document.querySelector<HTMLElement>('section[aria-labelledby="community-join"]');
  if (!banner) throw new Error("join banner not rendered");
  return banner;
}
