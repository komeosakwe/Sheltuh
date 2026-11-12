// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrganiserApplyPage, { metadata } from "@/app/organisers/apply/page";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * /organisers/apply, the For organisers page (redesign PR 6): the owner's mock, word for word,
 * except the lines the plan's §7 found untrue, and the application itself in the Start
 * organising panel.
 */

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace, push: vi.fn() }) }));

let organiser: { status: string } | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser, error: null, refetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  organiser = null;
  routerReplace.mockClear();
});

function renderPage(auth: Partial<AuthContextValue> = { status: "signed-out", email: undefined, accessToken: undefined }) {
  return render(
    <FakeAuthProvider value={fakeAuthValue(auth)}>
      <OrganiserApplyPage />
    </FakeAuthProvider>,
  );
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** Each child's text, spaced (block children run together in textContent). */
const parts = (el: Element) => Array.from(el.children).map(text).filter(Boolean).join(" ");

describe("/organisers/apply (For organisers)", () => {
  it("is titled For organisers, with the mock's h1 and lede", () => {
    renderPage();
    expect(metadata.title).toBe("For organisers — Sheltüh");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Your event. Your community.");
    // Display (Bootzy, in capitals by CSS), as Community's h1.
    expect(h1).toHaveClass("display-l");
    expect(screen.getByText("Bring your creative events to the people who want to be there.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("Get started goes to the Start organising panel and See how it works to the four steps, both on the page", () => {
    const { container } = renderPage();
    const getStarted = screen.getByRole("link", { name: "Get started" });
    expect(getStarted).toHaveAttribute("href", "#start");
    expect(getStarted).toHaveClass("btn-signal");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    expect(container.querySelector("#start")).toBe(
      screen.getByRole("region", { name: "Sign in to apply as an organiser." }),
    );
    expect(container.querySelector("#how-it-works")).toBe(
      screen.getByRole("region", { name: "Publish your first event in four steps" }),
    );
    // The page's one orange action.
    expect(container.querySelectorAll(".btn-signal")).toHaveLength(1);
  });

  it("the hero photo is the licensed string-lights photo, decorative", () => {
    renderPage();
    const hero = screen.getByRole("region", { name: "Your event. Your community." });
    const img = hero.querySelector("img");
    expect(decodeURIComponent(img?.getAttribute("src") ?? "")).toContain("/events/street-market.jpg");
    expect(img).toHaveAttribute("alt", "");
  });

  it("Create, Reach and Grow say only what's true (§7)", () => {
    renderPage();
    const cards = screen.getAllByRole("listitem").filter((li) => li.querySelector("h2"));
    expect(cards.map(parts)).toEqual([
      "Create Publish your event Set up tickets, times and venue in minutes. Every organiser is checked by a person.",
      "Reach Find your audience Your event shows to people who follow you.",
      "Grow Manage and improve See ticket sales in one place, then plan your next one.",
    ]);
  });

  it("the four steps, numbered, in order", () => {
    renderPage();
    const steps = within(screen.getByRole("region", { name: "Publish your first event in four steps" })).getAllByRole("listitem");
    expect(steps.map((li) => within(li).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Apply",
      "Get checked",
      "Publish",
      "Sell & connect",
    ]);
    expect(steps.map(parts)).toEqual([
      "01 Apply Sign in and tell us about you and your events.",
      "02 Get checked A person reviews every organiser before you go live.",
      "03 Publish Add tickets, times, venue and photos.",
      "04 Sell & connect Fans buy tickets, save your event and see who’s going.",
    ]);
  });

  it("Why Sheltüh?: the interviews' 13 of 15 (never a bare 87%), and the four true reasons", () => {
    renderPage();
    const why = screen.getByRole("region", { name: "Creative audiences, not everyone." });
    expect(within(why).getByText("13 of 15").parentElement).toHaveTextContent(
      "13 of 15 people we spoke to skipped an event because they didn’t know anyone going",
    );
    expect(why).not.toHaveTextContent(/87/);
    const terms = within(why).getAllByRole("term").map(text);
    const definitions = within(why).getAllByRole("definition").map(text);
    expect(terms).toEqual(["Creative audiences", "Curated discovery", "Community connections", "Clear pricing"]);
    expect(definitions).toEqual([
      "Music, art, fashion and culture — niche events reach people who are looking for them.",
      "Only the good stuff. Every organiser is checked by a person.",
      "Who’s going turns a ticket into a night with your people.",
      "Free events are free. Paid tickets carry one small booking fee each, and your ticket sales are paid out to you through Stripe.",
    ]);
  });

  it("drops every claim the code doesn't support (§7)", () => {
    renderPage();
    const main = document.body;
    for (const untrue of [
      /and event is checked/i,
      /follow your scene/i,
      /on every card/i,
      /See saves/i,
      /communities/i,
      /save and finish later/i,
      /event-goers/i,
      /87\s*%/,
    ]) {
      expect(main).not.toHaveTextContent(untrue);
    }
  });

  it("small orange text only on Dark: the straps and step numbers are muted on White", () => {
    renderPage();
    for (const strap of ["Publish your event", "Find your audience", "Manage and improve"]) {
      expect(screen.getByText(strap)).toHaveClass("text-muted", "dark:text-signal");
    }
    expect(screen.getByText("01")).toHaveClass("text-muted", "dark:text-signal");
  });

  it("signed out, the panel offers Sign in and Create an account, both coming back here", () => {
    renderPage();
    const panel = screen.getByRole("region", { name: "Sign in to apply as an organiser." });
    expect(panel).toHaveTextContent("Start organising");
    expect(within(panel).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Forganisers%2Fapply");
    expect(within(panel).getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/signup?next=%2Forganisers%2Fapply",
    );
  });

  it("signed in, the panel holds the application form", () => {
    renderPage({});
    const panel = screen.getByRole("region", { name: "Become an organiser" });
    expect(within(panel).getByLabelText("Organiser name")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Submit application" })).toBeInTheDocument();
  });

  it("an approved organiser still goes straight to the dashboard", () => {
    organiser = { status: "approved" };
    renderPage({});
    expect(routerReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("the hero photo is in the licence register", () => {
    const register = readFileSync(path.resolve(import.meta.dirname, "../public/events/README.md"), "utf8");
    expect(register).toMatch(/`street-market\.jpg`[^\n]*For organisers hero/);
  });

  it("uses the named type styles: section h2s heading-xl, the panel's heading-h1, the figure figure-xl", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Publish your first event in four steps" })).toHaveClass("heading-xl");
    expect(screen.getByRole("heading", { level: 2, name: "Creative audiences, not everyone." })).toHaveClass("heading-xl");
    expect(screen.getByRole("heading", { level: 2, name: "Sign in to apply as an organiser." })).toHaveClass("heading-h1");
    expect(screen.getByRole("heading", { level: 2, name: "Create" })).toHaveClass("heading-h2");
    expect(screen.getByRole("heading", { level: 3, name: "Apply" })).toHaveClass("heading-h3");
    expect(screen.getByText("13 of 15")).toHaveClass("figure-xl", "text-signal");
  });

  it("the hero lifts off the Dark page with the --hover fill (data-ink-lift, globals.css)", () => {
    renderPage();
    const hero = screen.getByRole("region", { name: "Your event. Your community." });
    expect(hero).toHaveAttribute("data-surface", "ink");
    expect(hero).toHaveAttribute("data-ink-lift");
    const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\[data-theme="dark"\] \[data-surface="ink"\]\[data-ink-lift\] \{\s*--background: var\(--hover\);/);
  });
});
