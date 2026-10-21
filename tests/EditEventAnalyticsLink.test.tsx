// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "evt-1" }) }));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));
vi.mock("@/lib/api/events", () => ({
  getMyEvent: vi.fn().mockResolvedValue({ eventId: "evt-1", title: "Night Market", status: "published" }),
}));
vi.mock("@/components/dashboard/EventEditor", () => ({ default: () => <p>Editor</p> }));

afterEach(cleanup);

describe("EditEventPageContent", () => {
  it("links to the event's analytics once it loads, above the editor", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <EditEventPageContent />
      </FakeAuthProvider>,
    );
    const link = await screen.findByRole("link", { name: "Analytics" });
    expect(link).toHaveAttribute("href", "/dashboard/events/evt-1/analytics");
    expect(link.compareDocumentPosition(screen.getByText("Editor")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
