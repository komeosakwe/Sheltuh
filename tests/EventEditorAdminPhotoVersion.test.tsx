// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { AdminEventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * A photo change bumps the event's version (updatedAt;
 * supabase/migrations/20261023000100_review_hardening.sql), so the admin
 * editor must make its next save against the version the photo save
 * returned, not the one the event save returned before it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/api/events", () => ({
  updateEventDraft: vi.fn(),
  createEventDraft: vi.fn(),
  submitEventForReview: vi.fn(),
  fetchPrivateEventImage: vi.fn().mockResolvedValue("blob:preview"),
}));

const adminUpdateEvent = vi.fn();
const adminDeleteEventImage = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: vi.fn(),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: (...args: unknown[]) => adminDeleteEventImage(...args),
}));

afterEach(cleanup);

const EVENT: AdminEventRecord = {
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
  imageUrl: "/api/events/evt-1/image?v=1",
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: true,
  status: "published",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T01:00:00.000Z",
  organiserPlatformManaged: false,
  curation: { boost: 1, excluded: false },
};

it("after a save that changes the photo, the next save carries the photo save's version", async () => {
  adminUpdateEvent.mockResolvedValueOnce({ ...EVENT, updatedAt: "2026-10-20T02:00:00.000Z" });
  adminDeleteEventImage.mockResolvedValueOnce({ ...EVENT, imageUrl: undefined, updatedAt: "2026-10-20T03:00:00.000Z" });
  adminUpdateEvent.mockResolvedValueOnce({ ...EVENT, imageUrl: undefined, updatedAt: "2026-10-20T04:00:00.000Z" });
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventEditor mode="admin" initial={EVENT} getToken={vi.fn().mockResolvedValue("token")} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Remove photo" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(adminDeleteEventImage).toHaveBeenCalledTimes(1));
  expect(adminUpdateEvent.mock.calls[0][1].expectedUpdatedAt).toBe("2026-10-20T01:00:00.000Z");

  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(2));
  // Not 02:00 (the event save's): the photo removal after it made that stale.
  expect(adminUpdateEvent.mock.calls[1][1].expectedUpdatedAt).toBe("2026-10-20T03:00:00.000Z");
});
