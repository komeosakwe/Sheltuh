// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventQueue from "@/components/admin/EventQueue";
import { adminListEvents } from "@/lib/api/admin";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/admin", () => ({
  adminListEvents: vi.fn().mockResolvedValue({
    items: [
      {
        organiserId: "org-1",
        eventId: "evt-1",
        slug: "neon-static",
        title: "Neon Static",
        description: "Four bands.",
        category: "live-music",
        venueName: "The Tote",
        venueAddress: "71 Johnston St",
        suburb: "Collingwood",
        startsAt: "2027-03-06T09:00:00.000Z",
        endsAt: "2027-03-06T12:30:00.000Z",
        organiserName: "Static Collective",
        ticketTypes: [],
        status: "pending_review",
        moderationLog: [],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  }),
  adminApproveEvent: vi.fn(),
  adminRejectEvent: vi.fn(),
  adminUnpublishEvent: vi.fn(),
}));

afterEach(cleanup);

describe("EventQueue", () => {
  it("asks for every event in the status, ended ones included (no past/upcoming toggle yet)", async () => {
    vi.mocked(adminListEvents).mockClear();
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <EventQueue />
      </FakeAuthProvider>,
    );
    await screen.findByRole("link", { name: "Edit Neon Static" });
    expect(adminListEvents).toHaveBeenCalledWith(
      { status: "pending_review", upcoming: false, cursor: undefined },
      expect.any(Function),
    );
    fireEvent.click(within(screen.getByRole("group", { name: "Show events" })).getByRole("button", { name: "Published" }));
    await vi.waitFor(() =>
      expect(adminListEvents).toHaveBeenLastCalledWith(
        { status: "published", upcoming: false, cursor: undefined },
        expect.any(Function),
      ),
    );
  });

  it("links to the admin editor: a new event, and each listed event's edit page", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <EventQueue />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "New event" })).toHaveAttribute("href", "/admin/events/new");
    expect(await screen.findByRole("link", { name: "Edit Neon Static" })).toHaveAttribute("href", "/admin/events/evt-1/edit");
  });

  it("status filters are toggle buttons: pressed is announced and marked with the two dots, not colour alone", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <EventQueue />
      </FakeAuthProvider>,
    );
    const group = screen.getByRole("group", { name: "Show events" });
    const pending = within(group).getByRole("button", { name: "Pending review" });
    expect(pending).toHaveAttribute("aria-pressed", "true");
    expect(pending.querySelector("[data-selected-dots]")).not.toBeNull();
    const published = within(group).getByRole("button", { name: "Published" });
    expect(published).toHaveAttribute("aria-pressed", "false");
    expect(published.querySelector("[data-selected-dots]")).toBeNull();

    fireEvent.click(published);
    expect(published).toHaveAttribute("aria-pressed", "true");
    expect(published.querySelector("[data-selected-dots]")).not.toBeNull();
    expect(pending.querySelector("[data-selected-dots]")).toBeNull();
    await screen.findByRole("link", { name: "Edit Neon Static" });
  });
});
