// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import type { ClipMetadata } from "@/lib/clip-precheck";
import { CLIP_MESSAGES, MAX_CLIP_BYTES } from "@/lib/clip-rules";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The event editor's clip field (docs/design/event-clips.md §5.4), behind
 * NEXT_PUBLIC_EVENT_CLIPS: the browser's pre-checks with the server's exact
 * words, a required description and (for a new clip) the rights
 * confirmation, the upload with progress and Cancel after the event is
 * saved, then the server's check, and only then a submission; the admin's
 * own routes, with the next save made against the version the clip step
 * returned. Every server error is shown in the field.
 */

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/** Every API call, in order, by name. */
const calls: string[] = [];
const log =
  <T,>(name: string, impl: (...args: unknown[]) => T) =>
  (...args: unknown[]) => {
    calls.push(name);
    return impl(...args);
  };

const api = vi.hoisted(() => ({
  updateEventDraft: vi.fn(),
  createEventDraft: vi.fn(),
  fetchPrivateEventImage: vi.fn(),
  submitEventForReview: vi.fn(),
  requestClipUpload: vi.fn(),
  uploadClipToStorage: vi.fn(),
  attachClip: vi.fn(),
  deleteClip: vi.fn(),
  getClipPreview: vi.fn(),
  adminUpdateEvent: vi.fn(),
  adminRequestClipUpload: vi.fn(),
  adminAttachClip: vi.fn(),
  adminDeleteClip: vi.fn(),
  readMetadata: vi.fn(),
}));

vi.mock("@/lib/api/events", async (importOriginal) => ({
  // The real check (it only reads the error): the editor tells a payouts refusal apart with it.
  isPayoutsRequiredError: (await importOriginal<typeof import("@/lib/api/events")>()).isPayoutsRequiredError,
  isRefundPolicyTightenedError: (await importOriginal<typeof import("@/lib/api/events")>()).isRefundPolicyTightenedError,
  updateEventDraft: (...args: unknown[]) => api.updateEventDraft(...args),
  createEventDraft: (...args: unknown[]) => api.createEventDraft(...args),
  submitEventForReview: (...args: unknown[]) => api.submitEventForReview(...args),
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
  fetchPrivateEventImage: (...args: unknown[]) => api.fetchPrivateEventImage(...args),
}));
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: vi.fn(),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminUpdateEvent: (...args: unknown[]) => api.adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));
vi.mock("@/lib/api/clips", () => ({
  requestClipUpload: (...args: unknown[]) => api.requestClipUpload(...args),
  uploadClipToStorage: (...args: unknown[]) => api.uploadClipToStorage(...args),
  attachClip: (...args: unknown[]) => api.attachClip(...args),
  deleteClip: (...args: unknown[]) => api.deleteClip(...args),
  getClipPreview: (...args: unknown[]) => api.getClipPreview(...args),
  adminRequestClipUpload: (...args: unknown[]) => api.adminRequestClipUpload(...args),
  adminAttachClip: (...args: unknown[]) => api.adminAttachClip(...args),
  adminDeleteClip: (...args: unknown[]) => api.adminDeleteClip(...args),
}));
// The real checks, with the hidden video's reading stood in for (jsdom can't decode video).
vi.mock("@/lib/clip-precheck", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clip-precheck")>();
  return {
    ...actual,
    precheckClip: (file: File) => actual.precheckClip(file, (blob) => api.readMetadata(blob) as Promise<ClipMetadata | null>),
  };
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
  suburb: "Testville",
  startsAt: "2026-09-25T10:00:00.000Z",
  endsAt: "2026-09-25T13:00:00.000Z",
  organiserName: "Test Org",
  ticketTypes: [{ id: "ga", name: "General Admission", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  status: "draft",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const SAVED_CLIP = {
  url: "/api/events/evt-1/clip?v=1761000000000",
  durationMs: 9000,
  width: 1080,
  height: 1920,
  description: "Dancers under a mirror ball.",
};
const TICKET = { uploadId: "up-1", uploadUrl: "https://project.supabase.test/storage/v1/object/upload/sign/x", expiresAt: "", maxBytes: MAX_CLIP_BYTES };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "1");
  calls.length = 0;
  push.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchPrivateEventImage.mockResolvedValue("blob:photo");
  api.updateEventDraft.mockImplementation(log("updateEventDraft", async () => ({ ...EVENT })));
  api.submitEventForReview.mockImplementation(log("submitEventForReview", async () => ({ ...EVENT, status: "pending_review" })));
  api.requestClipUpload.mockImplementation(log("requestClipUpload", async () => TICKET));
  api.uploadClipToStorage.mockImplementation(log("uploadClipToStorage", async () => undefined));
  api.attachClip.mockImplementation(log("attachClip", async () => ({ ...EVENT, clip: { ...SAVED_CLIP, description: "A crowd sings along." } })));
  api.deleteClip.mockImplementation(log("deleteClip", async () => ({ ...EVENT })));
  api.getClipPreview.mockResolvedValue({ url: "https://project.supabase.test/signed/preview.mp4", expiresAt: "" });
  api.readMetadata.mockResolvedValue({ durationMs: 12_000, width: 1080, height: 1920 });
  URL.createObjectURL = vi.fn(() => "blob:clip");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderEditor(overrides: Partial<EventRecord> = {}) {
  const onSaved = vi.fn();
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={{ ...EVENT, ...overrides }} onSaved={onSaved} />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

const picker = () => screen.getByLabelText(/Event clip \(optional\)/, { selector: "input" });
function mp4(size = 4 * 1024 * 1024, name = "clip.mp4", type = "video/mp4") {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
async function choose(file: File) {
  fireEvent.change(picker(), { target: { files: [file] } });
  await act(async () => {});
}
async function chooseValid() {
  await choose(mp4());
  fireEvent.change(screen.getByLabelText("Describe the clip (required)"), { target: { value: "A crowd sings along." } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I own this clip/ }));
}
const status = () => document.getElementById("event-clip-status") as HTMLElement;

describe("EventClipField: behind the flag", () => {
  it("isn't there with NEXT_PUBLIC_EVENT_CLIPS unset", () => {
    vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "");
    renderEditor();
    expect(screen.queryByText("Event clip (optional)")).toBeNull();
  });

  it("follows the photo, with the picker, hint and no clip yet", () => {
    renderEditor();
    expect(picker()).toHaveAttribute("accept", "video/mp4,video/quicktime");
    expect(screen.getByText("Choose a clip")).toBeInTheDocument();
    expect(screen.getByText("No clip yet")).toBeInTheDocument();
    expect(screen.getByText(/Up to 15 seconds, no sound, MP4 or MOV \(H\.264\), up to 10 MB\./)).toBeInTheDocument();
    // No "No sound" label anywhere: silent is the rule, said once in the hint.
    expect(screen.queryByText(/^No sound$/i)).toBeNull();
    const photo = screen.getByText("Event photo");
    expect(photo.compareDocumentPosition(screen.getByText("Event clip (optional)")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("EventClipField: the browser's checks (§5.4), in the server's words", () => {
  it.each([
    ["a WebM", mp4(1000, "clip.webm", "video/webm"), null, CLIP_MESSAGES.notMp4],
    ["a file over the cap", mp4(MAX_CLIP_BYTES + 200_000), null, CLIP_MESSAGES.tooLarge(MAX_CLIP_BYTES + 200_000)],
    ["a 16 second clip", mp4(), { durationMs: 16_200, width: 1080, height: 1920 }, CLIP_MESSAGES.tooLong(16_200)],
    ["a 4K clip", mp4(), { durationMs: 8000, width: 3840, height: 2160 }, CLIP_MESSAGES.tooManyPixels],
  ])("refuses %s", async (_name, file, metadata, message) => {
    api.readMetadata.mockResolvedValue(metadata);
    renderEditor();
    await choose(file);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(picker()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("No clip yet")).toBeInTheDocument();
  });

  it("leaves a file this browser can't read to the server (a MOV with no type, too)", async () => {
    api.readMetadata.mockResolvedValue(null);
    renderEditor();
    await choose(mp4(2_000_000, "IMG_0001.MOV", ""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Clip preview")).toHaveAttribute("src", "blob:clip");
    expect(status()).toHaveTextContent("Ready to upload when you save.");
    expect(screen.getByRole("button", { name: "Discard new clip" })).toBeInTheDocument();
    expect(screen.getByText("Choose another clip")).toBeInTheDocument();
  });
});

describe("EventClipField: what a save needs", () => {
  it("a new clip needs a description and the rights confirmation; nothing is saved without them", async () => {
    renderEditor();
    await choose(mp4());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(CLIP_MESSAGES.describe)).toBeInTheDocument();
    expect(screen.getByText(CLIP_MESSAGES.rights)).toBeInTheDocument();
    expect(screen.getByLabelText("Describe the clip (required)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Describe the clip (required)")).toHaveAccessibleDescription(
      /What happens in it, for people who can’t see it\. Shown under the clip\. Describe the clip\./,
    );
    expect(screen.getByRole("checkbox", { name: /I own this clip/ })).toHaveAttribute("aria-invalid", "true");
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(api.requestClipUpload).not.toHaveBeenCalled();
  });

  it("counts the description against its 300 characters", async () => {
    renderEditor();
    await choose(mp4());
    const box = screen.getByLabelText("Describe the clip (required)");
    expect(box).toHaveAttribute("maxlength", "300");
    fireEvent.change(box, { target: { value: "Crowd." } });
    expect(screen.getByText("6/300")).toBeInTheDocument();
  });
});

describe("EventClipField: saving", () => {
  it("Submit saves the event, uploads, has it checked and attached, and only then submits", async () => {
    const { onSaved } = renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.submitEventForReview).toHaveBeenCalled());
    expect(calls).toEqual(["updateEventDraft", "requestClipUpload", "uploadClipToStorage", "attachClip", "submitEventForReview"]);
    expect(api.requestClipUpload.mock.calls[0].slice(0, 2)).toEqual(["evt-1", { sizeBytes: 4 * 1024 * 1024, contentType: "video/mp4" }]);
    expect(api.uploadClipToStorage.mock.calls[0][0]).toBe(TICKET.uploadUrl);
    expect(api.uploadClipToStorage.mock.calls[0][2]).toMatchObject({ contentType: "video/mp4" });
    expect(api.attachClip.mock.calls[0].slice(0, 2)).toEqual([
      "evt-1",
      { uploadId: "up-1", description: "A crowd sings along.", rightsConfirmed: true },
    ]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "pending_review" }));
  });

  it("Submit pressed while a save is uploading waits for that upload, and doesn't upload it twice", async () => {
    let finish: () => void = () => {};
    api.uploadClipToStorage.mockImplementation(log("uploadClipToStorage", () => new Promise<void>((resolve) => (finish = resolve))));
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.uploadClipToStorage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(api.submitEventForReview).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(api.submitEventForReview).toHaveBeenCalled());
    expect(api.requestClipUpload).toHaveBeenCalledTimes(1);
    expect(api.attachClip).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("attachClip")).toBeLessThan(calls.indexOf("submitEventForReview"));
  });

  it("shows progress every 10%, and Cancel stops the upload: nothing attached, the clip kept for the next save", async () => {
    let signal: AbortSignal | undefined;
    api.uploadClipToStorage.mockImplementation(
      log("uploadClipToStorage", (_url, _file, options) => {
        const opts = options as { onProgress: (f: number) => void; signal: AbortSignal };
        signal = opts.signal;
        opts.onProgress(0.42);
        opts.onProgress(0.47);
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new DOMException("The upload was cancelled.", "AbortError")));
        });
      }),
    );
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(status()).toHaveTextContent("Uploading clip… 40%"));
    expect(status()).toHaveAttribute("aria-live", "polite");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("value", "40");
    expect(bar).toHaveAccessibleName("Uploading clip… 40%");
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => expect(status()).toHaveTextContent("Upload cancelled. The event was saved without the new clip."));
    // Back to the file input (the Cancel button has gone).
    await waitFor(() => expect(picker()).toHaveFocus());
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(api.attachClip).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled();
  });

  it("says when the server checks it, then that it's saved, and previews the saved clip", async () => {
    let attach: (record: EventRecord) => void = () => {};
    api.attachClip.mockImplementation(log("attachClip", () => new Promise<EventRecord>((resolve) => (attach = resolve))));
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(status()).toHaveTextContent("Checking the clip…"));
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    await act(async () => attach({ ...EVENT, clip: SAVED_CLIP }));
    await waitFor(() => expect(status()).toHaveTextContent("Clip saved."));
    await waitFor(() => expect(screen.getByLabelText("Clip preview")).toHaveAttribute("src", "https://project.supabase.test/signed/preview.mp4"));
    expect(api.getClipPreview).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(screen.getByRole("button", { name: "Remove clip" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it.each([
    ["HEVC", new ApiError(400, "Invalid", { clip: CLIP_MESSAGES.hevc }), CLIP_MESSAGES.hevc],
    ["sound", new ApiError(400, "Invalid", { clip: CLIP_MESSAGES.audio }), CLIP_MESSAGES.audio],
    ["a locked event", new ApiError(409, CLIP_MESSAGES.editLocked, { clip: CLIP_MESSAGES.editLocked }), CLIP_MESSAGES.editLocked],
    ["an expired upload", new ApiError(410, "Gone"), CLIP_MESSAGES.uploadExpired],
    ["the day's limit", new ApiError(429, CLIP_MESSAGES.rateLimited), CLIP_MESSAGES.rateLimited],
    ["clips unavailable", new ApiError(503, "Unavailable"), CLIP_MESSAGES.unavailable],
  ])("shows the server's refusal (%s) in the field, and doesn't submit", async (_name, error, message) => {
    api.attachClip.mockImplementation(log("attachClip", () => Promise.reject(error)));
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(document.getElementById("event-clip-error")).toHaveTextContent(message);
    // Focus goes to the reason, and the status line says nothing over it.
    await waitFor(() => expect(document.getElementById("event-clip-error")).toHaveFocus());
    expect(status()).toHaveTextContent(/^$/);
    expect(api.submitEventForReview).not.toHaveBeenCalled();
  });

  it("a dropped connection offers Try again, which saves again", async () => {
    api.uploadClipToStorage.mockImplementationOnce(
      log("uploadClipToStorage", () => Promise.reject(new ApiError(0, CLIP_MESSAGES.networkDrop, { clip: CLIP_MESSAGES.networkDrop }))),
    );
    HTMLFormElement.prototype.requestSubmit = function requestSubmit(this: HTMLFormElement) {
      this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CLIP_MESSAGES.networkDrop);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.attachClip).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      "updateEventDraft",
      "requestClipUpload",
      "uploadClipToStorage",
      "updateEventDraft",
      "requestClipUpload",
      "uploadClipToStorage",
      "attachClip",
    ]);
  });

  it("a saved clip: Remove clip removes it at the save; a new description alone is saved without a new upload", async () => {
    // The event saves answer with the clip it has (the server's word on it).
    api.updateEventDraft.mockImplementation(log("updateEventDraft", async () => ({ ...EVENT, clip: SAVED_CLIP })));
    renderEditor({ clip: SAVED_CLIP });
    expect(await screen.findByLabelText("Clip preview")).toHaveAttribute("src", "https://project.supabase.test/signed/preview.mp4");
    expect(screen.getByLabelText("Describe the clip (required)")).toHaveValue(SAVED_CLIP.description);
    fireEvent.change(screen.getByLabelText("Describe the clip (required)"), { target: { value: "Dancers, a mirror ball, confetti." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.attachClip).toHaveBeenCalled());
    // The rights were confirmed when the clip was added: a new description alone doesn't send them.
    expect(api.attachClip.mock.calls[0].slice(0, 2)).toEqual(["evt-1", { description: "Dancers, a mirror ball, confetti." }]);
    expect(api.requestClipUpload).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    expect(screen.getByText("No clip yet")).toBeInTheDocument();
    expect(status()).toHaveTextContent("The clip will be removed when you save.");
    await waitFor(() => expect(picker()).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.deleteClip).toHaveBeenCalledWith("evt-1", expect.any(Function)));
    await waitFor(() => expect(status()).toHaveTextContent("Clip removed."));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("EventClipField: admin mode", () => {
  const ADMIN_EVENT: AdminEventRecord = {
    ...EVENT,
    status: "published",
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: true,
    organiserPlatformManaged: false,
    curation: { boost: 1, excluded: false },
    updatedAt: "2026-10-20T01:00:00.000Z",
  };

  it("uses the admin's routes with the log note, and the next save carries the clip step's version", async () => {
    api.adminUpdateEvent.mockImplementation(log("adminUpdateEvent", async () => ({ ...ADMIN_EVENT, updatedAt: "2026-10-20T02:00:00.000Z" })));
    api.adminRequestClipUpload.mockImplementation(log("adminRequestClipUpload", async () => TICKET));
    api.adminAttachClip.mockImplementation(
      log("adminAttachClip", async () => ({ ...ADMIN_EVENT, clip: SAVED_CLIP, updatedAt: "2026-10-20T03:00:00.000Z" })),
    );
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" initial={ADMIN_EVENT} getToken={vi.fn().mockResolvedValue("token")} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    await chooseValid();
    fireEvent.change(screen.getByLabelText(/Note for the event/), { target: { value: "Organiser's clip, by email." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminAttachClip).toHaveBeenCalled());
    expect(calls).toEqual(["adminUpdateEvent", "adminRequestClipUpload", "uploadClipToStorage", "adminAttachClip"]);
    expect(api.adminAttachClip.mock.calls[0].slice(0, 2)).toEqual([
      "evt-1",
      { uploadId: "up-1", description: "A crowd sings along.", rightsConfirmed: true, reason: "Organiser's clip, by email." },
    ]);
    expect(api.requestClipUpload).not.toHaveBeenCalled();
    expect(api.attachClip).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminUpdateEvent).toHaveBeenCalledTimes(2));
    expect(api.adminUpdateEvent.mock.calls[1][1].expectedUpdatedAt).toBe("2026-10-20T03:00:00.000Z");
  });
});

describe("EventClipField: a file still being checked (M1)", () => {
  it("says so, and Save waits for it: never saved without the clip just chosen", async () => {
    let read: (metadata: ClipMetadata | null) => void = () => {};
    api.readMetadata.mockImplementation(() => new Promise((resolve) => (read = resolve)));
    renderEditor();
    fireEvent.change(picker(), { target: { files: [mp4()] } });
    await act(async () => {});
    expect(status()).toHaveTextContent("Checking the file…");
    expect(status()).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await act(async () => {});
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    // The check passes: the clip is in, so the save now needs its description and rights.
    await act(async () => read({ durationMs: 9000, width: 1080, height: 1920 }));
    expect(await screen.findByText(CLIP_MESSAGES.describe)).toBeInTheDocument();
    expect(screen.getByText(CLIP_MESSAGES.rights)).toBeInTheDocument();
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled();
  });

  it("a file refused while Save waited stops the save, with the reason shown", async () => {
    let read: (metadata: ClipMetadata | null) => void = () => {};
    api.readMetadata.mockImplementation(() => new Promise((resolve) => (read = resolve)));
    renderEditor();
    fireEvent.change(picker(), { target: { files: [mp4()] } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await act(async () => read({ durationMs: 20_000, width: 1080, height: 1920 }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CLIP_MESSAGES.tooLong(20_000));
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent(/^$/);
  });

  it("Submit waits for it too, then uploads it before submitting", async () => {
    let read: (metadata: ClipMetadata | null) => void = () => {};
    renderEditor({ clip: SAVED_CLIP });
    await screen.findByLabelText("Clip preview");
    api.readMetadata.mockImplementation(() => new Promise((resolve) => (read = resolve)));
    fireEvent.change(picker(), { target: { files: [mp4()] } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await act(async () => read({ durationMs: 9000, width: 1080, height: 1920 }));
    // A new clip needs the rights confirmed: asked for, nothing sent.
    expect(await screen.findByText(CLIP_MESSAGES.rights)).toBeInTheDocument();
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I own this clip/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.submitEventForReview).toHaveBeenCalled());
    expect(calls).toEqual(["updateEventDraft", "requestClipUpload", "uploadClipToStorage", "attachClip", "submitEventForReview"]);
  });
});

describe("EventClipField: when the clip step fails after the event saved (M2)", () => {
  const SAVED_PHOTO = "/api/events/evt-1/image?v=2";

  it("keeps the saved event (its photo), tells the page, and doesn't submit", async () => {
    api.updateEventDraft.mockImplementation(log("updateEventDraft", async () => ({ ...EVENT, imageUrl: SAVED_PHOTO })));
    api.attachClip.mockImplementation(log("attachClip", () => Promise.reject(new ApiError(429, CLIP_MESSAGES.rateLimited))));
    const { onSaved } = renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CLIP_MESSAGES.rateLimited);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: SAVED_PHOTO, status: "draft" }));
    expect(api.submitEventForReview).not.toHaveBeenCalled();
    // The photo field shows the saved photo.
    await waitFor(() => expect(api.fetchPrivateEventImage).toHaveBeenCalledWith(SAVED_PHOTO, expect.any(Function)));
    // The clip waits for the next save.
    expect(screen.getByRole("button", { name: "Discard new clip" })).toBeInTheDocument();
  });

  it("a new event: kept here (its photo), not navigated to, and the next save updates it", async () => {
    api.createEventDraft.mockImplementation(log("createEventDraft", async () => ({ ...EVENT, imageUrl: SAVED_PHOTO })));
    api.attachClip.mockImplementationOnce(log("attachClip", () => Promise.reject(new ApiError(503, "Unavailable"))));
    const onSaved = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
        <EventEditor getToken={vi.fn().mockResolvedValue("token")} onSaved={onSaved} />
      </FakeAuthProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Test Event" } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "A test event." } });
    fireEvent.change(screen.getByLabelText(/^Venue name/), { target: { value: "The Venue" } });
    fireEvent.change(screen.getByLabelText(/^Venue address/), { target: { value: "1 Test St" } });
    fireEvent.change(screen.getByLabelText(/^Suburb/), { target: { value: "Testville" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "22:00" } });
    fireEvent.change(document.getElementById("ticket-0-name") as HTMLElement, { target: { value: "General" } });
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CLIP_MESSAGES.unavailable);
    expect(push).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => expect(api.fetchPrivateEventImage).toHaveBeenCalledWith(SAVED_PHOTO, expect.any(Function)));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/evt-1"));
    expect(api.createEventDraft).toHaveBeenCalledTimes(1);
    expect(api.updateEventDraft).toHaveBeenCalledWith("evt-1", expect.any(Object), expect.any(Function));
  });

  it("admin: the note is cleared (it's in the log with the save), the page is told, the version kept", async () => {
    const ADMIN: AdminEventRecord = {
      ...EVENT,
      ticketingMode: "sheltuh",
      organiserPlatformManaged: false,
      curation: { boost: 1, excluded: false },
      updatedAt: "2026-10-20T01:00:00.000Z",
    };
    api.adminUpdateEvent.mockImplementation(log("adminUpdateEvent", async () => ({ ...ADMIN, updatedAt: "2026-10-20T02:00:00.000Z" })));
    api.adminRequestClipUpload.mockImplementation(log("adminRequestClipUpload", async () => TICKET));
    api.adminAttachClip.mockImplementationOnce(log("adminAttachClip", () => Promise.reject(new ApiError(503, "Unavailable"))));
    const onSaved = vi.fn();
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" initial={ADMIN} getToken={vi.fn().mockResolvedValue("token")} onSaved={onSaved} />
      </FakeAuthProvider>,
    );
    await chooseValid();
    fireEvent.change(screen.getByLabelText(/Note for the event/), { target: { value: "Fixing the venue." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CLIP_MESSAGES.unavailable);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: "2026-10-20T02:00:00.000Z" }));
    expect(screen.getByLabelText(/Note for the event/)).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminUpdateEvent).toHaveBeenCalledTimes(2));
    expect(api.adminUpdateEvent.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: "2026-10-20T02:00:00.000Z", reason: null });
  });
});

describe("EventClipField: Cancel with a Submit queued (L3), and edits while uploading (L4)", () => {
  it("Cancel also stops a queued Submit: no fresh upload, nothing submitted", async () => {
    api.uploadClipToStorage.mockImplementation(
      log("uploadClipToStorage", (_url, _file, options) => {
        const { signal } = options as { signal: AbortSignal };
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("The upload was cancelled.", "AbortError")));
        });
      }),
    );
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.uploadClipToStorage).toHaveBeenCalled());
    // Nothing to change while it's being sent.
    expect(screen.getByLabelText("Describe the clip (required)")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /I own this clip/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(status()).toHaveTextContent("Upload cancelled. The event was saved without the new clip."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for review" })).not.toBeDisabled());
    expect(api.requestClipUpload).toHaveBeenCalledTimes(1);
    expect(api.uploadClipToStorage).toHaveBeenCalledTimes(1);
    expect(api.submitEventForReview).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Describe the clip (required)")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard new clip" })).toBeInTheDocument();
  });

  it("a queued Submit's older record doesn't undo the clip the save just attached", async () => {
    let finish: () => void = () => {};
    api.uploadClipToStorage.mockImplementation(log("uploadClipToStorage", () => new Promise<void>((resolve) => (finish = resolve))));
    api.attachClip.mockImplementation(
      log("attachClip", async () => ({ ...EVENT, clip: SAVED_CLIP, updatedAt: "2026-01-01T00:00:05.000Z" })),
    );
    renderEditor();
    await chooseValid();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.uploadClipToStorage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    // Its event save answers before the clip is attached: no clip, an older version.
    await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalledTimes(2));
    await act(async () => finish());
    await waitFor(() => expect(api.submitEventForReview).toHaveBeenCalled());
    expect(api.attachClip).toHaveBeenCalledTimes(1);
    expect(api.deleteClip).not.toHaveBeenCalled();
    expect(screen.queryByText("No clip yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove clip" })).toBeInTheDocument();
  });
});

describe("EventClipField: Remove, Discard and the preview (UX #4, L5)", () => {
  it("Remove can be undone; Undo puts focus back on Remove clip", async () => {
    renderEditor({ clip: SAVED_CLIP });
    await screen.findByLabelText("Clip preview");
    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    expect(status()).toHaveTextContent("The clip will be removed when you save.");
    await waitFor(() => expect(picker()).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(status()).toHaveTextContent(/^$/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove clip" })).toHaveFocus());
    expect(await screen.findByLabelText("Clip preview")).toBeInTheDocument();
  });

  it("Remove, then a new pick, then Discard: the saved clip is kept, and says so", async () => {
    renderEditor({ clip: SAVED_CLIP });
    await screen.findByLabelText("Clip preview");
    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    await choose(mp4());
    expect(status()).toHaveTextContent("Ready to upload when you save.");
    fireEvent.click(screen.getByRole("button", { name: "Discard new clip" }));
    expect(status()).toHaveTextContent("Keeping the current clip.");
    await waitFor(() => expect(picker()).toHaveFocus());
    expect(screen.getByRole("button", { name: "Remove clip" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled());
    expect(api.deleteClip).not.toHaveBeenCalled();
  });

  it("a saved clip's preview that won't play gets a fresh URL once, then says it couldn't load", async () => {
    api.getClipPreview
      .mockResolvedValueOnce({ url: "https://project.supabase.test/signed/old.mp4", expiresAt: "" })
      .mockResolvedValue({ url: "https://project.supabase.test/signed/new.mp4", expiresAt: "" });
    renderEditor({ clip: SAVED_CLIP });
    const first = await screen.findByLabelText("Clip preview");
    expect(first).toHaveAttribute("src", "https://project.supabase.test/signed/old.mp4");
    fireEvent.error(first);
    await waitFor(() => expect(screen.getByLabelText("Clip preview")).toHaveAttribute("src", "https://project.supabase.test/signed/new.mp4"));
    expect(api.getClipPreview).toHaveBeenCalledTimes(2);
    fireEvent.error(screen.getByLabelText("Clip preview"));
    expect(await screen.findByText("Couldn’t load the preview")).toBeInTheDocument();
    expect(api.getClipPreview).toHaveBeenCalledTimes(2);
  });

  it("a new pick this browser can't play says so instead of a broken player", async () => {
    renderEditor();
    await choose(mp4());
    fireEvent.error(screen.getByLabelText("Clip preview"));
    expect(screen.getByText("This browser can’t preview this clip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard new clip" })).toBeInTheDocument();
  });
});

describe("EventClipField: uploads switched off", () => {
  const ADMIN_WITH_CLIP: AdminEventRecord = {
    ...EVENT,
    status: "published",
    ticketingMode: "sheltuh",
    organiserPlatformManaged: false,
    curation: { boost: 1, excluded: false },
    clip: SAVED_CLIP,
    updatedAt: "2026-10-20T01:00:00.000Z",
  };
  function renderAdmin(initial: AdminEventRecord) {
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" initial={initial} getToken={vi.fn().mockResolvedValue("token")} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
  }
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "");
    api.adminUpdateEvent.mockImplementation(log("adminUpdateEvent", async () => ({ ...ADMIN_WITH_CLIP, updatedAt: "2026-10-20T02:00:00.000Z" })));
    api.adminAttachClip.mockImplementation(
      log("adminAttachClip", async () => ({ ...ADMIN_WITH_CLIP, clip: { ...SAVED_CLIP, description: "Confetti." }, updatedAt: "2026-10-20T03:00:00.000Z" })),
    );
    api.adminDeleteClip.mockImplementation(log("adminDeleteClip", async () => ({ ...ADMIN_WITH_CLIP, clip: undefined, updatedAt: "2026-10-20T03:00:00.000Z" })));
  });

  it("an admin still sees an event's clip, and can describe it again: only choosing a file is gone", async () => {
    renderAdmin(ADMIN_WITH_CLIP);
    expect(screen.getByText("Event clip (optional)")).toBeInTheDocument();
    expect(await screen.findByLabelText("Clip preview")).toHaveAttribute("src", "https://project.supabase.test/signed/preview.mp4");
    expect(document.getElementById("event-clip")).toBeNull();
    expect(screen.queryByText(/Choose (a|another) clip/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Describe the clip (required)"), { target: { value: "Confetti." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminAttachClip).toHaveBeenCalled());
    expect(api.adminAttachClip.mock.calls[0].slice(0, 2)).toEqual(["evt-1", { description: "Confetti." }]);
    expect(api.adminRequestClipUpload).not.toHaveBeenCalled();
  });

  it("an admin can remove it (focus on Undo, there being no file input), and the field stays", async () => {
    renderAdmin(ADMIN_WITH_CLIP);
    await screen.findByLabelText("Clip preview");
    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminDeleteClip).toHaveBeenCalledWith("evt-1", expect.any(Function), undefined));
    await waitFor(() => expect(status()).toHaveTextContent("Clip removed."));
    expect(screen.getByText("No clip yet")).toBeInTheDocument();
  });

  it("no field for an admin's event without a clip, nor for an organiser's", () => {
    renderAdmin({ ...ADMIN_WITH_CLIP, clip: undefined });
    expect(screen.queryByText("Event clip (optional)")).toBeNull();
    cleanup();
    renderEditor({ clip: SAVED_CLIP });
    expect(screen.queryByText("Event clip (optional)")).toBeNull();
  });
});
