// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminEditEvent from "@/components/admin/AdminEditEvent";
import type { AdminEventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  useParams: () => ({ eventId: "evt-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const adminGetEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminGetEvent: (...args: unknown[]) => adminGetEvent(...args),
}));

// The Trending panel is covered in TrendingPanel.test.tsx.
const getEventCuration = vi.fn();
const setEventCuration = vi.fn();
vi.mock("@/lib/api/trending", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/trending")>()),
  getEventCuration: (...args: unknown[]) => getEventCuration(...args),
  setEventCuration: (...args: unknown[]) => setEventCuration(...args),
}));

// The editor itself is covered in AdminEventEditor.test.tsx. This one only plays its part in sharing the page's
// one sign-in form: a save that finds the session expired, and whether it may show the form.
vi.mock("@/components/dashboard/EventEditor", async () => {
  const { useState } = await import("react");
  function FakeEditor({ reauthForm, onReauthNeeded }: { reauthForm?: boolean; onReauthNeeded?: (needed: boolean) => void }) {
    const [expired, setExpired] = useState(false);
    return (
      <div data-testid="event-editor">
        <button
          type="button"
          onClick={() => {
            setExpired(true);
            onReauthNeeded?.(true);
          }}
        >
          Save (session expired)
        </button>
        {expired && <p>{reauthForm ? "Editor: sign-in form" : "Editor: no form"}</p>}
      </div>
    );
  }
  return { default: FakeEditor };
});

afterEach(cleanup);
beforeEach(() => {
  adminGetEvent.mockReset();
  setEventCuration.mockReset();
  getEventCuration.mockReset().mockResolvedValue({ eventId: "evt-1", boost: 1, excluded: false, updatedAt: null, log: [] });
});

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

  it("has the event's Trending panel below the editor, linked from the top of the page", async () => {
    adminGetEvent.mockResolvedValue(EVENT);
    renderPage();
    expect(await screen.findByRole("link", { name: "Trending" })).toHaveAttribute("href", "#trending");
    const panel = screen.getByRole("region", { name: "Trending" });
    expect(panel).toHaveAttribute("id", "trending");
    expect(await screen.findByText(/^Now:/)).toHaveTextContent("Now: Normal (×1)");
    expect(getEventCuration.mock.calls[0][0]).toBe("evt-1");
  });

  it("shows one sign-in form at a time: whichever of the editor and the Trending panel needed it last", async () => {
    adminGetEvent.mockResolvedValue(EVENT);
    setEventCuration.mockRejectedValue(new SessionExpiredError());
    renderPage();
    const panel = await screen.findByRole("region", { name: "Trending" });
    await within(panel).findByText(/^Now:/);
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Keep out of Trending" }));
    fireEvent.change(within(panel).getByRole("textbox", { name: /Reason/ }), { target: { value: "Spam" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Save Trending settings" }));
    });
    // The panel has it.
    expect(within(panel).getByLabelText("Password")).toBeInTheDocument();

    // Then the editor's save finds the session expired too: it takes the form over.
    fireEvent.click(screen.getByRole("button", { name: "Save (session expired)" }));
    expect(screen.getByText("Editor: sign-in form")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(panel).toHaveTextContent("Your session has expired. Sign in again, then save again.");
  });

  it("the editor keeps the form while the Trending panel doesn't need it", async () => {
    adminGetEvent.mockResolvedValue(EVENT);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Save (session expired)" }));
    expect(screen.getByText("Editor: sign-in form")).toBeInTheDocument();
  });
});
