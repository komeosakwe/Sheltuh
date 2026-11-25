// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SettingsLoading from "@/app/(account)/account/loading";
import SavedLoading from "@/app/(account)/saved/loading";
import AcceptTicketLoading from "@/app/(account)/tickets/accept/loading";
import MyTicketsLoading from "@/app/(account)/tickets/(list)/loading";
import ReceivedTicketLoading from "@/app/(account)/tickets/received/[transferId]/loading";
import DashboardLoading from "@/app/dashboard/loading";
import EventLoading from "@/app/events/[slug]/loading";

/**
 * The routes' loading.tsx: what a tap shows at once while the next page loads. Each is the page's own first
 * draw (its title where it has one, then its loader), so nothing moves when the page arrives, and each
 * loader has an accessible name.
 */

afterEach(cleanup);

describe("route loading states", () => {
  it("the event page: the event page's own loader, said once in a polite status", () => {
    render(<EventLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading event…");
  });

  it("My tickets: its title, the cards' shapes (hidden from assistive tech) and a polite status", () => {
    const { container } = render(<MyTicketsLoading />);
    expect(screen.getByRole("heading", { level: 1, name: "My tickets" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your tickets…");
    expect(container.querySelector("[data-my-tickets-loading]")).toHaveAttribute("aria-hidden", "true");
  });

  it("Settings and Saved: their titles, then a named loader", () => {
    render(<SettingsLoading />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading your account" })).toBeInTheDocument();
    cleanup();
    render(<SavedLoading />);
    expect(screen.getByRole("heading", { level: 1, name: "Saved" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument();
  });

  it("a received ticket and an Accept link get their own page's loader, not My tickets' list", () => {
    const { container } = render(<ReceivedTicketLoading />);
    expect(screen.getByRole("progressbar", { name: "Loading your ticket" })).toBeInTheDocument();
    expect(container.querySelector("[data-my-tickets-loading]")).toBeNull();
    cleanup();
    render(<AcceptTicketLoading />);
    expect(screen.getByRole("progressbar", { name: "Opening your ticket" })).toBeInTheDocument();
  });

  it("My tickets' loading screen wraps the list only (its own route group), never a received ticket or an Accept link", () => {
    // A loading.tsx wraps every route below its folder, and Next prefetches a dynamic route only as far as
    // its first one, so one in app/(account)/tickets would open /tickets/received/{id} on the list's skeleton.
    const tickets = path.join(process.cwd(), "app", "(account)", "tickets");
    expect(existsSync(path.join(tickets, "loading.tsx"))).toBe(false);
    expect(existsSync(path.join(tickets, "(list)", "loading.tsx"))).toBe(true);
    expect(existsSync(path.join(tickets, "(list)", "page.tsx"))).toBe(true);
    expect(existsSync(path.join(tickets, "received", "[transferId]", "page.tsx"))).toBe(true);
    expect(existsSync(path.join(tickets, "accept", "page.tsx"))).toBe(true);
  });

  it("an organiser page: a loader named for the page (not the organiser record's \"Loading\")", () => {
    render(<DashboardLoading />);
    expect(screen.getByRole("progressbar", { name: "Loading page" })).toBeInTheDocument();
  });
});
