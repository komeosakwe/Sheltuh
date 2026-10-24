// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventQueueItem from "@/components/admin/EventQueueItem";
import { ClipViewerProvider } from "@/components/events/ClipViewer";
import type { AdminEventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The admin queue's clip row (docs/design/event-clips.md §5.5), whenever the
 * event has a clip (NEXT_PUBLIC_EVENT_CLIPS gates uploading only, never
 * reviewing one that exists): the clip's length and description, then Play
 * clip (before Approve… in the tab order), which fetches a short-lived
 * preview URL and opens the page's clip viewer with it, says it couldn't, or
 * asks to sign in again when the session has run out.
 */

vi.mock("@/lib/api/admin", () => ({
  adminApproveEvent: vi.fn(),
  adminRejectEvent: vi.fn(),
  adminUnpublishEvent: vi.fn(),
}));
const getClipPreview = vi.fn();
vi.mock("@/lib/api/clips", () => ({ getClipPreview: (...args: unknown[]) => getClipPreview(...args) }));

const CLIP = {
  url: "/api/events/evt-1/clip?v=1",
  durationMs: 12_000,
  width: 1920,
  height: 1080,
  description: "The band soundchecks; the drummer counts in.",
};
const ITEM: AdminEventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "neon-static",
  title: "Neon Static",
  description: "Four bands.",
  category: "live-music",
  venueName: "The Tote",
  venueAddress: "71 Johnston St",
  suburb: "Collingwood",
  startsAt: "2099-03-06T09:00:00.000Z",
  endsAt: "2099-03-06T12:30:00.000Z",
  organiserName: "Static Collective",
  ticketTypes: [],
  ticketingMode: "sheltuh",
  status: "pending_review",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  organiserPlatformManaged: false,
  curation: { boost: 1, excluded: false },
  clip: CLIP,
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "1");
  getClipPreview.mockReset();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as unknown as HTMLMediaElement["play"];
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderItem(item: AdminEventRecord = ITEM, { reauthOwner = null, onClaimReauth = vi.fn() }: { reauthOwner?: string | null; onClaimReauth?: (owner: string | null) => void } = {}) {
  const tree = (owner: string | null) => (
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <ClipViewerProvider>
        <ul>
          <EventQueueItem
            item={item}
            listStatus="pending_review"
            getToken={vi.fn().mockResolvedValue("token")}
            onRemoved={vi.fn()}
            reauthOwner={owner}
            onClaimReauth={onClaimReauth}
            now={Date.parse("2026-10-24T00:00:00.000Z")}
          />
        </ul>
      </ClipViewerProvider>
    </FakeAuthProvider>
  );
  const result = render(tree(reauthOwner));
  return { ...result, rerenderWith: (owner: string | null) => result.rerender(tree(owner)) };
}

// Label in Name: the name contains the visible "Play clip".
const playClip = () => screen.getByRole("button", { name: "Play clip: Neon Static, 0:12" });

describe("the admin queue's clip row (§5.5)", () => {
  it("shows the length and description, with Play clip before Approve…", () => {
    renderItem();
    expect(screen.getByText("Clip · 0:12")).toBeInTheDocument();
    expect(screen.getByText(CLIP.description)).toBeInTheDocument();
    const play = playClip();
    expect(play).toHaveTextContent(/^Play clip$/);
    const approve = screen.getByRole("button", { name: "Approve Neon Static…" });
    expect(play.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });

  it("isn't there without a clip", () => {
    renderItem({ ...ITEM, clip: undefined });
    expect(screen.queryByText(/^Clip ·/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Play clip/ })).toBeNull();
  });

  it("is there with uploads switched off: a clip that exists is always reviewable", () => {
    vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "");
    renderItem();
    expect(screen.getByText("Clip · 0:12")).toBeInTheDocument();
    expect(screen.getByText(CLIP.description)).toBeInTheDocument();
    expect(playClip()).toBeInTheDocument();
  });

  it("fetches a preview URL (busy meanwhile), then plays it in the viewer with no poster; focus comes back", async () => {
    let resolve: (value: { url: string; expiresAt: string }) => void = () => {};
    getClipPreview.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderItem();
    const play = playClip();
    fireEvent.click(play);
    expect(getClipPreview).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(play).toHaveTextContent("Loading clip…");
    expect(play).toHaveAttribute("aria-disabled", "true");
    await act(async () => resolve({ url: "https://project.supabase.test/signed/evt-1.mp4", expiresAt: "" }));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).toHaveAttribute("open");
    const video = dialog.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("https://project.supabase.test/signed/evt-1.mp4");
    expect(video).not.toHaveAttribute("poster");
    expect(video).toHaveAccessibleDescription(CLIP.description);
    // Landscape: the wide dialog.
    expect(dialog).toHaveClass("sm:max-w-2xl");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(playClip()).toHaveFocus();
  });

  it("says when the clip can't be loaded", async () => {
    getClipPreview.mockRejectedValue(new Error("Not found"));
    renderItem();
    fireEvent.click(playClip());
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load the clip. Try again.");
    expect(document.querySelector("dialog")).not.toHaveAttribute("open");
  });

  it("an expired session asks to sign in again (claiming the queue's one sign-in form), then Play works", async () => {
    getClipPreview.mockRejectedValueOnce(new SessionExpiredError());
    const onClaimReauth = vi.fn();
    const { rerenderWith } = renderItem(ITEM, { onClaimReauth });
    fireEvent.click(playClip());
    await act(async () => {});
    expect(onClaimReauth).toHaveBeenCalledWith("clip:evt-1");
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Sign in again, then play the clip.");
    expect(screen.queryByText("Couldn’t load the clip. Try again.")).toBeNull();
    expect(document.querySelector("dialog")).not.toHaveAttribute("open");

    // Given the form (only one may be shown at a time), it's offered here.
    rerenderWith("clip:evt-1");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in again below, then play the clip.");

    // Pressing Play again tries again, and gives the form back.
    getClipPreview.mockResolvedValueOnce({ url: "https://project.supabase.test/signed/evt-1.mp4", expiresAt: "" });
    fireEvent.click(playClip());
    await act(async () => {});
    expect(onClaimReauth).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/Your session has expired/)).toBeNull();
    expect(document.querySelector("dialog")).toHaveAttribute("open");
  });
});
