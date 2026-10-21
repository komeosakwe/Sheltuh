// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminEditEvent from "@/components/admin/AdminEditEvent";
import type { AdminEventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  useParams: () => ({ eventId: "evt-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const adminGetEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminGetEvent: (...args: unknown[]) => adminGetEvent(...args),
}));

// The editor itself is covered in AdminEventEditor.test.tsx.
vi.mock("@/components/dashboard/EventEditor", () => ({
  default: () => <div data-testid="event-editor" />,
}));

afterEach(cleanup);
beforeEach(() => adminGetEvent.mockReset());

const EVENT: AdminEventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "laneway",
  title: "Laneway Nights",
  description: "Free gigs.",
  category: "live-music",
  venueName: "The Tote",
  venueAddress: "71 Johnston St",
  suburb: "Collingwood",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T12:30:00.000Z",
  organiserName: "Sheltüh Presents",
  ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: true,
  status: "published",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T01:02:03.456Z",
  organiserPlatformManaged: true,
};

function renderPage() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <AdminEditEvent />
    </FakeAuthProvider>,
  );
}

describe("AdminEditEvent", () => {
  it("links a platform-managed organiser's Sheltüh-ticketed event to its door check-in", async () => {
    adminGetEvent.mockResolvedValue(EVENT);
    renderPage();
    const link = await screen.findByRole("link", { name: "Open door check-in" });
    expect(link).toHaveAttribute("href", "/dashboard/evt-1/check-in");
    expect(screen.getByTestId("event-editor")).toBeInTheDocument();
  });

  it("offers no check-in for an organiser's own event (they run their door)", async () => {
    adminGetEvent.mockResolvedValue({ ...EVENT, organiserPlatformManaged: false });
    renderPage();
    await screen.findByTestId("event-editor");
    expect(screen.queryByRole("link", { name: "Open door check-in" })).toBeNull();
  });

  it("offers no check-in for an external event (no Sheltüh tickets)", async () => {
    adminGetEvent.mockResolvedValue({
      ...EVENT,
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/laneway",
      externalProvider: "Humanitix",
    });
    renderPage();
    await screen.findByTestId("event-editor");
    expect(screen.queryByRole("link", { name: "Open door check-in" })).toBeNull();
  });
});
