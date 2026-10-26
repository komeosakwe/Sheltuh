// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EditEventPageContent, { editEventPageTitle } from "@/components/dashboard/EditEventPageContent";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "evt-1" }) }));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));
const getMyEvent = vi.fn();
vi.mock("@/lib/api/events", () => ({
  getMyEvent: (...args: unknown[]) => getMyEvent(...args),
}));
vi.mock("@/components/dashboard/EventEditor", () => ({ default: () => <p>Editor</p> }));

afterEach(() => {
  cleanup();
  getMyEvent.mockReset();
});

function renderPage(status: string) {
  getMyEvent.mockResolvedValue({ eventId: "evt-1", title: "Night Market", status });
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <EditEventPageContent />
    </FakeAuthProvider>,
  );
}

describe("EditEventPageContent", () => {
  it("links to the event's analytics once it loads, above the editor", async () => {
    renderPage("published");
    const link = await screen.findByRole("link", { name: "Analytics" });
    expect(link).toHaveAttribute("href", "/dashboard/events/evt-1/analytics");
    expect(link.compareDocumentPosition(screen.getByText("Editor")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["draft", "Edit event"],
    ["rejected", "Edit event"],
    // The dashboard's "View submission" leads here: not a locked "Edit event".
    ["pending_review", "Your submission"],
    ["published", "Your event"],
  ])("a %s event's h1 is %s", async (status, title) => {
    renderPage(status);
    await screen.findByText("Editor");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });

  it("says Edit event while it loads", () => {
    expect(editEventPageTitle(null)).toBe("Edit event");
  });
});
