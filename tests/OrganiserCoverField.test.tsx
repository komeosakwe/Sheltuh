// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserCoverField, { coverErrorMessage, narrowCoverWarning } from "@/components/dashboard/OrganiserCoverField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { ImageError } from "@/lib/image";

const uploadOrganiserCover = vi.fn();
const deleteOrganiserCover = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  uploadOrganiserCover: (...args: unknown[]) => uploadOrganiserCover(...args),
  deleteOrganiserCover: (...args: unknown[]) => deleteOrganiserCover(...args),
}));
const prepareCoverImage = vi.fn();
vi.mock("@/lib/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image")>()),
  prepareCoverImage: (...args: unknown[]) => prepareCoverImage(...args),
}));

const COVER_URL = "/api/organisers/org-1/cover?v=1730000000000";
const COVER_SMALL_URL = "/api/organisers/org-1/cover?size=small&v=1730000000000";
const RECORD: OrganiserRecord = {
  ownerUserId: "user-1",
  organiserId: "org-1",
  displayName: "Northside Noise",
  contactEmail: "org@example.com",
  description: "Loud nights in small rooms.",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};
const PREPARED = new Blob(["cropped"], { type: "image/jpeg" });

let blobCount = 0;
beforeEach(() => {
  for (const fn of [uploadOrganiserCover, deleteOrganiserCover, prepareCoverImage]) fn.mockReset();
  prepareCoverImage.mockResolvedValue({ image: PREPARED, width: 2800 });
  blobCount = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${++blobCount}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(cleanup);

const getToken = vi.fn().mockResolvedValue("t");
const withCover: OrganiserRecord = { ...RECORD, coverUrl: COVER_URL, coverSmallUrl: COVER_SMALL_URL };

function renderField(record: OrganiserRecord = RECORD) {
  return render(<OrganiserCoverField organiser={record} getToken={getToken} />);
}

function picker(): HTMLElement {
  return screen.getByLabelText(/Cover photo \(optional\)/);
}

function pick(file: File) {
  fireEvent.change(picker(), { target: { files: [file] } });
}

function statusText(): string {
  return screen
    .getAllByRole("status")
    .map((s) => s.textContent)
    .join(" | ");
}

const jpeg = () => new File(["x"], "cover.jpg", { type: "image/jpeg" });

describe("OrganiserCoverField", () => {
  it("is the field with id cover; starts empty with a placeholder, a named picker, the rules and no Remove", () => {
    const { container } = renderField();
    expect(container.querySelector("#cover")).toBe(container.querySelector("[data-organiser-cover-field]"));
    expect(screen.getByText("No cover photo yet")).toBeInTheDocument();
    const input = picker();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAccessibleName("Cover photo (optional) Choose a cover photo");
    expect(input).toHaveAccessibleDescription(/We crop it to a wide 7:2 strip/);
    expect(input).toHaveAccessibleDescription(/Only upload a photo you have the rights to use\./);
    expect(screen.queryByRole("button", { name: "Remove cover photo" })).toBeNull();
    // No phone-crop shades over a placeholder.
    expect(container.querySelector("[data-phone-crop]")).toBeNull();
  });

  it("shows the stored cover (the small one) with the phone-crop shades, and offers Change and Remove", () => {
    const { container } = renderField(withCover);
    expect(screen.getByRole("img", { name: "Your cover photo" })).toHaveAttribute("src", COVER_SMALL_URL);
    const shades = container.querySelectorAll("[data-phone-crop]");
    expect(shades).toHaveLength(2);
    for (const shade of shades) expect(shade).toHaveAttribute("aria-hidden", "true");
    expect(picker()).toHaveAccessibleName("Cover photo (optional) Change cover photo");
    expect(screen.getByRole("button", { name: "Remove cover photo" })).toBeInTheDocument();
  });

  it("checks the type before cropping or sending anything", () => {
    renderField();
    pick(new File(["x"], "a.heic", { type: "image/heic" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG or WebP image.");
    expect(prepareCoverImage).not.toHaveBeenCalled();
    expect(uploadOrganiserCover).not.toHaveBeenCalled();
  });

  it("crops the image, previews it while it uploads, then shows the stored cover", async () => {
    let resolve: (record: OrganiserRecord) => void = () => {};
    uploadOrganiserCover.mockReturnValue(new Promise<OrganiserRecord>((r) => (resolve = r)));
    const { container } = renderField();
    const file = jpeg();
    pick(file);

    expect(screen.getByRole("img", { name: "Your new cover photo, uploading" })).toHaveAttribute("src", "blob:1");
    expect(statusText()).toContain("Uploading your cover photo…");
    expect(container.querySelector("[data-organiser-cover-field]")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(uploadOrganiserCover).toHaveBeenCalledWith(PREPARED, getToken));
    expect(prepareCoverImage).toHaveBeenCalledWith(file);
    expect(picker()).toHaveAttribute("aria-disabled", "true");
    pick(jpeg());
    expect(prepareCoverImage).toHaveBeenCalledTimes(1);

    await act(async () => resolve(withCover));
    expect(screen.getByRole("img", { name: "Your cover photo" })).toHaveAttribute("src", COVER_SMALL_URL);
    expect(statusText()).toContain("Cover photo saved. It’s on your public profile now.");
    expect(statusText()).not.toContain("enlarged");
    expect(screen.queryByText(/may look soft/)).toBeNull();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1"));
  });

  it("warns, without an alert, when the crop is narrower than 2240 px, and clears it on the next choice", async () => {
    prepareCoverImage.mockResolvedValueOnce({ image: PREPARED, width: 1600 });
    uploadOrganiserCover.mockResolvedValue(withCover);
    renderField();
    pick(jpeg());
    expect(await screen.findByText(narrowCoverWarning(1600))).toBeInTheDocument();
    expect(narrowCoverWarning(1600)).toBe(
      "Saved. This photo is 1,600 px wide where we crop it, so it’s enlarged to 2,240 px and may look soft on large screens. For a sharper cover, choose one at least 2,240 px wide.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(statusText()).toContain("It’s been enlarged, so it may look soft on large screens.");

    pick(jpeg());
    await waitFor(() => expect(uploadOrganiserCover).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/may look soft/)).toBeNull());
  });

  it("removes the cover and puts focus back on the picker", async () => {
    deleteOrganiserCover.mockResolvedValue(RECORD);
    renderField(withCover);
    fireEvent.click(screen.getByRole("button", { name: "Remove cover photo" }));
    await waitFor(() => expect(statusText()).toContain("Cover photo removed."));
    expect(deleteOrganiserCover).toHaveBeenCalledWith(getToken);
    expect(screen.getByText("No cover photo yet")).toBeInTheDocument();
    expect(picker()).toHaveFocus();
  });

  it("says when the stored cover can't be shown", () => {
    renderField(withCover);
    fireEvent.error(screen.getByRole("img", { name: "Your cover photo" }));
    expect(screen.getByText("Couldn’t show your cover photo")).toBeInTheDocument();
  });

  it.each([
    [new ApiError(400, "Bad.", { cover: "That image is over 24 megapixels." }), "That image is over 24 megapixels."],
    [new ApiError(400, "Bad."), "We couldn’t use that file. Choose a JPEG, PNG or WebP image."],
    [new ApiError(403, "Forbidden."), "Only approved organisers can add a cover photo."],
    [new ApiError(409, "Conflict."), "changed while the cover photo was uploading"],
    [new ApiError(413, "Too large."), "That image is over 4 MB, even after shrinking it. Choose a smaller one."],
    [new ApiError(429, "Slow down."), "You’ve changed your cover photo a lot today. Try again tomorrow."],
    [new ApiError(503, "Busy."), "We’re busy processing images right now."],
    [new ApiError(401, "Unauthorised."), SESSION_EXPIRED_MESSAGE],
    [new SessionExpiredError(), SESSION_EXPIRED_MESSAGE],
    [new ImageError("That image is over 4 MB, even after shrinking it. Choose a smaller one."), "over 4 MB"],
  ])("explains %s in plain words", async (err, expected) => {
    expect(coverErrorMessage(err, "fallback")).toContain(expected);
    uploadOrganiserCover.mockRejectedValue(err);
    renderField();
    pick(jpeg());
    expect(await screen.findByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
  });
});
