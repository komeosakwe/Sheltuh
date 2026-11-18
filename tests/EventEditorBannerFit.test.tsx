// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

/**
 * Round 2 Part 2: "Show the whole photo in the home banner" (event_images.banner_fit). Offered only
 * with a photo, where the photo itself can be edited (organisers: draft or rejected; admins: any);
 * saved with the focus in one PATCH …/image ({ focus?, bannerFit? }).
 */

vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const updateEventDraft = vi.fn();
const uploadEventImage = vi.fn();
const deleteEventImage = vi.fn();
const setEventImageDisplay = vi.fn();
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
  setEventImageDisplay: (...args: unknown[]) => setEventImageDisplay(...args),
  fetchPrivateEventImage: vi.fn().mockResolvedValue("blob:saved"),
}));

const adminUpdateEvent = vi.fn();
const adminSetEventImageDisplay = vi.fn();
const adminUploadEventImage = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: vi.fn(),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: (...args: unknown[]) => adminUploadEventImage(...args),
  adminDeleteEventImage: vi.fn(),
  adminSetEventImageDisplay: (...args: unknown[]) => adminSetEventImageDisplay(...args),
}));

vi.mock("@/lib/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image")>()),
  prepareEventImage: (...args: unknown[]) => prepareEventImage(...args),
}));

beforeEach(() => {
  stubMatchMedia();
  for (const fn of [updateEventDraft, uploadEventImage, deleteEventImage, setEventImageDisplay, prepareEventImage, adminUpdateEvent, adminSetEventImageDisplay, adminUploadEventImage]) {
    fn.mockReset();
  }
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

const LABEL = "Show the whole photo in the home banner";

function renderEditor(initial: EventRecord = EVENT) {
  const onSaved = vi.fn();
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={onSaved} />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

const checkbox = () => screen.findByRole("checkbox", { name: LABEL });
const preview = () => document.querySelector("[data-banner-preview] img") as HTMLImageElement | null;
const phonePreview = () => document.querySelector("[data-banner-phone-preview] img") as HTMLImageElement | null;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

function pickPhoto() {
  fireEvent.change(document.getElementById("event-image") as HTMLInputElement, {
    target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
  });
}

describe("EventEditor banner fit", () => {
  it("is offered with a photo, off by default, described, with 5:2 banner and 4:5 phone previews that crop until it's on", async () => {
    renderEditor();
    const box = await checkbox();
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(
      "If your event is featured at the top of the home page, show the whole photo instead of cropping it. Unticked, it’s cropped around your focus point.",
    );
    await waitFor(() => expect(preview()).not.toBeNull());
    expect(document.querySelector("[data-banner-preview] > div")).toHaveClass("aspect-[5/2]");
    expect(document.querySelector("[data-banner-phone-preview] > div")).toHaveClass("aspect-[4/5]");
    expect(screen.getByText("Banner")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(preview()).toHaveClass("object-cover");
    expect(phonePreview()).toHaveClass("object-cover");
    // The home's scrim where the words sit, on both, decorative: about two thirds of the banner, three quarters of the phone.
    const scrims = ["[data-banner-preview]", "[data-banner-phone-preview]"].map((frame) => document.querySelector(`${frame} [data-preview-scrim]`));
    for (const scrim of scrims) {
      expect(scrim).toHaveClass("banner-scrim", "banner-scrim-scaled", "absolute", "bottom-0");
      expect(scrim).toHaveAttribute("aria-hidden", "true");
    }
    expect(scrims[0]).toHaveClass("h-2/3");
    expect(scrims[1]).toHaveClass("h-3/4");

    // Both previews' photo loads while cropped; ticking the box then shows its backdrop at once (EventArt keeps a
    // photo loaded under another fit as loaded; the backdrop only waits for a photo that hasn't).
    for (const img of [preview(), phonePreview()]) {
      if (!img) throw new Error("no preview photo");
      Object.defineProperty(img, "naturalWidth", { value: 1600 });
      Object.defineProperty(img, "naturalHeight", { value: 900 });
      fireEvent.load(img);
    }
    expect(document.querySelector("[data-art-backdrop]")).toBeNull();
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(preview()).toHaveClass("object-contain");
    expect(document.querySelector("[data-banner-preview] [data-art-backdrop]")).not.toBeNull();
    // On the phone the whole photo sits at the top, clear of the words (FeaturedCarousel's max-sm:object-top).
    expect(phonePreview()).toHaveClass("object-contain", "object-top");
    expect(document.querySelector("[data-banner-phone-preview] [data-art-backdrop]")).not.toBeNull();
  });

  it("shows a saved whole fit as checked", async () => {
    renderEditor({ ...EVENT, bannerFit: "whole" });
    expect(await checkbox()).toBeChecked();
  });

  it("isn't offered without a photo", async () => {
    renderEditor({ ...EVENT, imageUrl: undefined, imageFocus: undefined });
    await screen.findByRole("button", { name: "Save draft" });
    expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
  });

  it("isn't offered on a published event (organisers can't change its photo; the API refuses too)", async () => {
    renderEditor({ ...EVENT, status: "published" });
    await screen.findByText(/Test Event/);
    expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Focus" })).toBeNull();
  });

  it("saving a changed fit sends only the fit, once, with no re-upload", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    setEventImageDisplay.mockResolvedValue({ ...EVENT, bannerFit: "whole" });
    const { onSaved } = renderEditor();
    fireEvent.click(await checkbox());
    save();
    // The save is over (the page has the fit's record) before nothing more is checked for.
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, bannerFit: "whole" }));
    expect(setEventImageDisplay).toHaveBeenCalledWith("evt-1", { bannerFit: "whole" }, expect.any(Function));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(1);
    expect(uploadEventImage).not.toHaveBeenCalled();
  });

  it("a moved focus and a changed fit go in one request", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT, bannerFit: "whole" });
    setEventImageDisplay.mockResolvedValue({ ...EVENT, imageFocus: { x: 35, y: 40 } });
    const { onSaved } = renderEditor({ ...EVENT, bannerFit: "whole" });
    fireEvent.click(await checkbox());
    fireEvent.keyDown(screen.getByRole("slider", { name: "Focus" }), { key: "ArrowRight" });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, imageFocus: { x: 35, y: 40 } }));
    expect(setEventImageDisplay).toHaveBeenCalledWith("evt-1", { focus: { x: 35, y: 40 }, bannerFit: "crop" }, expect.any(Function));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(1);
  });

  it("doesn't touch the photo when nothing about it changed (or the fit was put back)", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    const { onSaved } = renderEditor();
    const box = await checkbox();
    fireEvent.click(box);
    fireEvent.click(box);
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(EVENT));
    expect(setEventImageDisplay).not.toHaveBeenCalled();
    expect(uploadEventImage).not.toHaveBeenCalled();
  });

  it("a new photo goes up with its focus, then the fit follows in a second request (a replaced photo keeps its fit)", async () => {
    const picked = new Blob(["x"], { type: "image/jpeg" });
    prepareEventImage.mockResolvedValue(picked);
    updateEventDraft.mockResolvedValue(EVENT);
    uploadEventImage.mockResolvedValue({ ...EVENT, imageFocus: undefined, imageUrl: "/api/events/evt-1/image?v=2" });
    setEventImageDisplay.mockResolvedValue({ ...EVENT, imageUrl: "/api/events/evt-1/image?v=2", bannerFit: "whole" });
    const { onSaved } = renderEditor();
    pickPhoto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard new photo" })).toBeInTheDocument());
    fireEvent.click(await checkbox());
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, imageUrl: "/api/events/evt-1/image?v=2", bannerFit: "whole" }));
    expect(setEventImageDisplay).toHaveBeenCalledWith("evt-1", { bannerFit: "whole" }, expect.any(Function));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(1);
    expect(uploadEventImage).toHaveBeenCalledTimes(1);
    expect(uploadEventImage).toHaveBeenCalledWith("evt-1", picked, expect.any(Function), null);
    expect(uploadEventImage.mock.invocationCallOrder[0]).toBeLessThan(setEventImageDisplay.mock.invocationCallOrder[0]);
  });

  it("after an upload that already carries the chosen fit, sends nothing more", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    updateEventDraft.mockResolvedValue({ ...EVENT, bannerFit: "whole" });
    const uploaded = { ...EVENT, imageUrl: "/api/events/evt-1/image?v=2", bannerFit: "whole" as const };
    uploadEventImage.mockResolvedValue(uploaded);
    const { onSaved } = renderEditor({ ...EVENT, bannerFit: "whole" });
    pickPhoto();
    const box = await checkbox();
    fireEvent.click(box);
    fireEvent.click(box);
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(uploaded));
    expect(uploadEventImage).toHaveBeenCalledTimes(1);
    expect(setEventImageDisplay).not.toHaveBeenCalled();
  });

  it("when the fit fails after an upload, the photo stays saved (the page is told) and the fit is sent again on the next save", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    updateEventDraft.mockResolvedValue(EVENT);
    const uploaded = { ...EVENT, imageFocus: undefined, imageUrl: "/api/events/evt-1/image?v=2", updatedAt: "2026-01-02T00:00:00.000Z" };
    uploadEventImage.mockResolvedValue(uploaded);
    setEventImageDisplay.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ...uploaded, bannerFit: "whole" });
    const { onSaved } = renderEditor();
    pickPhoto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard new photo" })).toBeInTheDocument());
    fireEvent.click(await checkbox());
    save();
    await waitFor(() => expect(setEventImageDisplay).toHaveBeenCalledTimes(1));
    // The error is shown, and the saved photo is back in the field (not a pending one).
    expect(await screen.findByText("network")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(uploaded);
    expect(await screen.findByRole("button", { name: "Remove photo" })).toBeInTheDocument();
    expect(await checkbox()).toBeChecked();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true"));
    save();
    // The retry's answer reaches the page: the uploaded photo, now whole.
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ ...uploaded, bannerFit: "whole" }));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(2);
    expect(setEventImageDisplay.mock.calls[1][1]).toEqual({ bannerFit: "whole" });
    expect(uploadEventImage).toHaveBeenCalledTimes(1);
  });

  // CodeRabbit (PR #61, round 3): the earlier save's answer mustn't mark a newer choice as saved.
  it("a fit changed again while its save is under way is sent on the next save", async () => {
    updateEventDraft.mockResolvedValueOnce(EVENT).mockResolvedValueOnce({ ...EVENT, bannerFit: "whole" });
    let answer: (record: EventRecord) => void = () => {};
    setEventImageDisplay
      .mockImplementationOnce(() => new Promise<EventRecord>((resolve) => (answer = resolve)))
      .mockResolvedValueOnce({ ...EVENT, bannerFit: "crop" });
    const { onSaved } = renderEditor();
    const box = await checkbox();
    fireEvent.click(box);
    save();
    await waitFor(() => expect(setEventImageDisplay).toHaveBeenCalledTimes(1));
    expect(setEventImageDisplay.mock.calls[0][1]).toEqual({ bannerFit: "whole" });
    // Unticked while the first save's fit is on its way.
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    await act(async () => answer({ ...EVENT, bannerFit: "whole" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, bannerFit: "whole" }));
    expect(box).not.toBeChecked();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true"));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ ...EVENT, bannerFit: "crop" }));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(2);
    expect(setEventImageDisplay.mock.calls[1][1]).toEqual({ bannerFit: "crop" });
  });

  it("a focus moved again while its save is under way is sent on the next save", async () => {
    updateEventDraft.mockResolvedValueOnce(EVENT).mockResolvedValueOnce({ ...EVENT, imageFocus: { x: 35, y: 40 } });
    let answer: (record: EventRecord) => void = () => {};
    setEventImageDisplay
      .mockImplementationOnce(() => new Promise<EventRecord>((resolve) => (answer = resolve)))
      .mockResolvedValueOnce({ ...EVENT, imageFocus: { x: 40, y: 40 } });
    const { onSaved } = renderEditor();
    await checkbox();
    const slider = screen.getByRole("slider", { name: "Focus" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    save();
    await waitFor(() => expect(setEventImageDisplay).toHaveBeenCalledTimes(1));
    expect(setEventImageDisplay.mock.calls[0][1]).toEqual({ focus: { x: 35, y: 40 } });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await act(async () => answer({ ...EVENT, imageFocus: { x: 35, y: 40 } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, imageFocus: { x: 35, y: 40 } }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true"));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ ...EVENT, imageFocus: { x: 40, y: 40 } }));
    expect(setEventImageDisplay).toHaveBeenCalledTimes(2);
    expect(setEventImageDisplay.mock.calls[1][1]).toEqual({ focus: { x: 40, y: 40 } });
  });

  it("removing the photo removes the option and its fit: only the delete is sent", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT, bannerFit: "whole" });
    deleteEventImage.mockResolvedValue({ ...EVENT, imageUrl: undefined, imageFocus: undefined });
    const { onSaved } = renderEditor({ ...EVENT, bannerFit: "whole" });
    await checkbox();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull());
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EVENT, imageUrl: undefined, imageFocus: undefined }));
    expect(deleteEventImage).toHaveBeenCalledTimes(1);
    expect(setEventImageDisplay).not.toHaveBeenCalled();
  });

  it("Remove photo moves focus to Choose a photo (not the page), as does discarding the only photo", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    renderEditor();
    await checkbox();
    const remove = screen.getByRole("button", { name: "Remove photo" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull());
    const input = document.getElementById("event-image") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleName("Event photo Choose a photo");

    // An event with no saved photo: discarding the new one leaves none, so focus goes back to the picker too.
    cleanup();
    renderEditor({ ...EVENT, imageUrl: undefined, imageFocus: undefined });
    await screen.findByRole("button", { name: "Save draft" });
    pickPhoto();
    const discard = await screen.findByRole("button", { name: "Discard new photo" });
    discard.focus();
    fireEvent.click(discard);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard new photo" })).toBeNull());
    expect(document.getElementById("event-image")).toHaveFocus();
  });

  it("discarding a new photo over a saved one keeps focus on the button, now Remove photo", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    renderEditor();
    await checkbox();
    pickPhoto();
    const discard = await screen.findByRole("button", { name: "Discard new photo" });
    discard.focus();
    fireEvent.click(discard);
    const remove = await screen.findByRole("button", { name: "Remove photo" });
    expect(remove).toHaveFocus();
  });

  it("discarding a new photo brings back the saved photo's fit", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    renderEditor({ ...EVENT, bannerFit: "whole" });
    pickPhoto();
    const box = await checkbox();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard new photo" })).toBeInTheDocument());
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Discard new photo" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: LABEL })).toBeChecked());
  });
});

describe("Admin EventEditor banner fit", () => {
  const ADMIN_EVENT: AdminEventRecord = {
    ...EVENT,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: true,
    status: "published",
    organiserPlatformManaged: false,
    curation: { boost: 1, excluded: false },
  };

  it("an admin can set it on a published event, through the admin route, and the next save uses its version", async () => {
    adminUpdateEvent.mockResolvedValue({ ...ADMIN_EVENT, updatedAt: "2026-01-02T00:00:00.000Z" });
    const displayed: AdminEventRecord = { ...ADMIN_EVENT, bannerFit: "whole", updatedAt: "2026-01-03T00:00:00.000Z" };
    adminSetEventImageDisplay.mockResolvedValue(displayed);
    const onSaved = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" initial={ADMIN_EVENT} getToken={vi.fn().mockResolvedValue("token")} onSaved={onSaved} />
      </FakeAuthProvider>,
    );
    fireEvent.click(await checkbox());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(displayed));
    expect(adminSetEventImageDisplay).toHaveBeenCalledWith("evt-1", { bannerFit: "whole" }, expect.any(Function));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(adminUpdateEvent).toHaveBeenCalledTimes(2);
    expect(adminUpdateEvent.mock.calls[1][1].expectedUpdatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(adminSetEventImageDisplay).toHaveBeenCalledTimes(1);
  });

  it("when the fit fails after an admin upload, the page gets the uploaded record and the next save is made against its version", async () => {
    prepareEventImage.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    adminUpdateEvent.mockResolvedValue({ ...ADMIN_EVENT, updatedAt: "2026-01-02T00:00:00.000Z" });
    const uploaded: AdminEventRecord = { ...ADMIN_EVENT, imageUrl: "/api/events/evt-1/image?v=2", updatedAt: "2026-01-04T00:00:00.000Z" };
    adminUploadEventImage.mockResolvedValue(uploaded);
    adminSetEventImageDisplay.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ...uploaded, bannerFit: "whole", updatedAt: "2026-01-05T00:00:00.000Z" });
    const onSaved = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" initial={ADMIN_EVENT} getToken={vi.fn().mockResolvedValue("token")} onSaved={onSaved} />
      </FakeAuthProvider>,
    );
    pickPhoto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard new photo" })).toBeInTheDocument());
    fireEvent.click(await checkbox());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("network")).toBeInTheDocument();
    expect(adminUploadEventImage).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(uploaded);

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(2));
    expect(adminUpdateEvent.mock.calls[1][1].expectedUpdatedAt).toBe("2026-01-04T00:00:00.000Z");
    // The retry's answer reaches the page: the uploaded photo, now whole, at its new version.
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ ...uploaded, bannerFit: "whole", updatedAt: "2026-01-05T00:00:00.000Z" }));
    expect(adminSetEventImageDisplay).toHaveBeenCalledTimes(2);
    expect(adminSetEventImageDisplay.mock.calls[1][1]).toEqual({ bannerFit: "whole" });
    expect(adminUploadEventImage).toHaveBeenCalledTimes(1);
  });
});
