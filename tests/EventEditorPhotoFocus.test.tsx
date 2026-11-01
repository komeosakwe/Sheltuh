// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const updateEventDraft = vi.fn();
const uploadEventImage = vi.fn();
const deleteEventImage = vi.fn();
const setEventImageFocus = vi.fn();
const prepareEventImage = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => ({
  isPayoutsRequiredError: (await importOriginal<typeof import("@/lib/api/events")>()).isPayoutsRequiredError,
  isRefundPolicyTightenedError: (await importOriginal<typeof import("@/lib/api/events")>()).isRefundPolicyTightenedError,
  publishConflictCode: (await importOriginal<typeof import("@/lib/api/events")>()).publishConflictCode,
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: vi.fn(),
  publishEvent: vi.fn(),
  uploadEventImage: (...args: unknown[]) => uploadEventImage(...args),
  deleteEventImage: (...args: unknown[]) => deleteEventImage(...args),
  setEventImageFocus: (...args: unknown[]) => setEventImageFocus(...args),
  fetchPrivateEventImage: vi.fn().mockResolvedValue("blob:saved"),
}));
vi.mock("@/lib/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image")>()),
  prepareEventImage: (...args: unknown[]) => prepareEventImage(...args),
}));

beforeEach(() => {
  stubMatchMedia();
  for (const fn of [updateEventDraft, uploadEventImage, deleteEventImage, setEventImageFocus, prepareEventImage]) fn.mockReset();
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => "blob:picked");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  unstubMatchMedia();
});

const EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "test-event",
  title: "Test Event",
  description: "A test event.",
  category: "live-music",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  suburb: "Fitzroy",
  startsAt: "2026-09-25T10:00:00.000Z",
  endsAt: "2026-09-25T13:00:00.000Z",
  organiserName: "Test Org",
  imageUrl: "/api/events/evt-1/image?v=1",
  imageFocus: { x: 30, y: 40 },
  ticketTypes: [{ id: "new-1", name: "General Admission", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  status: "draft",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderEditor() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={EVENT} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const slider = () => screen.findByRole("slider", { name: "Focus" });

describe("EventEditor photo focus", () => {
  it("shows the saved focus, and saving a moved focus changes only the focus (no re-upload)", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    setEventImageFocus.mockResolvedValue({ ...EVENT, imageFocus: { x: 35, y: 40 } });
    renderEditor();
    const control = await slider();
    expect(control).toHaveAttribute("aria-valuetext", "30% across, 40% down");

    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(control).toHaveAttribute("aria-valuetext", "35% across, 40% down");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(setEventImageFocus).toHaveBeenCalledWith("evt-1", { x: 35, y: 40 }, expect.any(Function)));
    expect(uploadEventImage).not.toHaveBeenCalled();
  });

  it("does not touch the photo when the focus wasn't moved", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderEditor();
    await slider();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalled());
    expect(setEventImageFocus).not.toHaveBeenCalled();
    expect(uploadEventImage).not.toHaveBeenCalled();
  });

  it("a newly chosen photo starts in the middle and goes up with the focus set on it", async () => {
    const picked = new Blob(["x"], { type: "image/jpeg" });
    prepareEventImage.mockResolvedValue(picked);
    updateEventDraft.mockResolvedValue(EVENT);
    uploadEventImage.mockResolvedValue({ ...EVENT, imageFocus: { x: 50, y: 55 } });
    renderEditor();
    const before = await slider();
    expect(before).toHaveAttribute("aria-valuetext", "30% across, 40% down");

    fireEvent.change(document.getElementById("event-image") as HTMLInputElement, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(screen.getByRole("slider", { name: "Focus" })).toHaveAttribute("aria-valuetext", "50% across, 50% down"));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Focus" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(uploadEventImage).toHaveBeenCalledWith("evt-1", picked, expect.any(Function), { x: 50, y: 55 }));
    expect(setEventImageFocus).not.toHaveBeenCalled();
  });

  it("discarding the new photo brings the saved photo's focus back; removing the photo drops the control", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    renderEditor();
    await slider();
    fireEvent.change(document.getElementById("event-image") as HTMLInputElement, {
      target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(screen.getByRole("slider", { name: "Focus" })).toHaveAttribute("aria-valuetext", "50% across, 50% down"));
    fireEvent.click(screen.getByRole("button", { name: "Discard new photo" }));
    await waitFor(() => expect(screen.getByRole("slider", { name: "Focus" })).toHaveAttribute("aria-valuetext", "30% across, 40% down"));

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(screen.queryByRole("slider", { name: "Focus" })).toBeNull());
  });
});
