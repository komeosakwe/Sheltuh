// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventQueue from "@/components/admin/EventQueue";
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
  it("links to the admin editor: a new event, and each listed event's edit page", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <EventQueue />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "New event" })).toHaveAttribute("href", "/admin/events/new");
    expect(await screen.findByRole("link", { name: "Edit Neon Static" })).toHaveAttribute("href", "/admin/events/evt-1/edit");
  });
});
