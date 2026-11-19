// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserCoverField, { coverErrorMessage, narrowCoverWarning } from "@/components/dashboard/OrganiserCoverField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { ImageError } from "@/lib/image";
import { callsTokenFirst, fakeAuthValue, FakeAuthProvider, switchableSession } from "./test-utils/fakeAuth";

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

const withCover: OrganiserRecord = { ...RECORD, coverUrl: COVER_URL, coverSmallUrl: COVER_SMALL_URL };
const OWNER = { userId: "user-1", email: "org@example.com" };
const OTHER = { userId: "user-2", email: "other@example.com" };

/** Mounted signed in as OWNER; the session can change under it (session.become) or be re-rendered as another account. */
function renderField(record: OrganiserRecord = RECORD, session = switchableSession(OWNER)) {
  const tree = (account: typeof OWNER) => (
    <FakeAuthProvider value={fakeAuthValue({ status: "signed-in", ...account, ...session.auth })}>
      <OrganiserCoverField organiser={record} />
    </FakeAuthProvider>
  );
  const view = render(tree(OWNER));
  return { ...view, renderAs: (account: typeof OWNER) => view.rerender(tree(account)) };
}

/** The token the given API mock's last call would send: its last argument is the token getter. */
function sentToken(mock: ReturnType<typeof vi.fn>): Promise<string> {
  const args = mock.mock.lastCall ?? [];
  const getToken = args[args.length - 1];
  if (typeof getToken !== "function") throw new Error("No token getter passed");
  return (getToken as () => Promise<string>)();
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
    // The rules, then the rights, and nothing else.
    expect(input).toHaveAccessibleDescription(
      "JPEG, PNG or WebP, cropped to a wide 7:2 strip. 2240 × 640 px or larger looks sharpest; phones show the clear middle. Camera and location data is removed. Only upload a photo you have the rights to use.",
    );
    // A full-width button on phones.
    expect(screen.getByText("Choose a cover photo")).toHaveClass("max-sm:w-full");
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
    expect(screen.getByRole("button", { name: "Remove cover photo" })).toHaveClass("max-sm:w-full");
    expect(screen.getByText("Change cover photo")).toHaveClass("max-sm:w-full");
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
    // Busy, but not the status line: what it says is announced as it changes.
    const busyRegion = container.querySelector("[aria-busy='true']");
    expect(busyRegion).toHaveAttribute("data-organiser-cover-body");
    expect(container.querySelector("[data-organiser-cover-field]")).toContainElement(busyRegion as HTMLElement);
    for (const status of screen.getAllByRole("status")) expect(busyRegion).not.toContainElement(status);
    await waitFor(() => expect(uploadOrganiserCover).toHaveBeenCalledWith(PREPARED, expect.any(Function)));
    await expect(sentToken(uploadOrganiserCover)).resolves.toBe("user-1-token");
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
    expect(deleteOrganiserCover).toHaveBeenCalledWith(expect.any(Function));
    await expect(sentToken(deleteOrganiserCover)).resolves.toBe("user-1-token");
    expect(screen.getByText("No cover photo yet")).toBeInTheDocument();
    expect(picker()).toHaveFocus();
  });

  it("announces the removal while it's in flight, from the status line outside the busy body", async () => {
    let resolve: (record: OrganiserRecord) => void = () => {};
    deleteOrganiserCover.mockReturnValue(new Promise<OrganiserRecord>((r) => (resolve = r)));
    const { container } = renderField(withCover);
    fireEvent.click(screen.getByRole("button", { name: "Remove cover photo" }));

    expect(statusText()).toBe("Removing your cover photo…");
    expect(screen.getByRole("button", { name: "Removing…" })).toHaveAttribute("aria-disabled", "true");
    const busyRegion = container.querySelector("[aria-busy='true']");
    expect(busyRegion).toHaveAttribute("data-organiser-cover-body");
    for (const status of screen.getAllByRole("status")) expect(busyRegion).not.toContainElement(status);

    await act(async () => resolve(RECORD));
    expect(statusText()).toBe("Cover photo removed.");
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
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

  describe("only ever as the account it was opened as", () => {
    it("someone else signed in mid-upload (another tab, while the photo was being cropped): refused, never sent as them", async () => {
      const session = switchableSession(OWNER);
      const tokens: string[] = [];
      prepareCoverImage.mockImplementation(async () => {
        session.become(OTHER); // After the pick, before the upload asks for its token.
        return { image: PREPARED, width: 2800 };
      });
      uploadOrganiserCover.mockImplementation(async (_image: Blob, getToken: () => Promise<string>) => {
        tokens.push(await getToken());
        return withCover;
      });
      renderField(RECORD, session);
      pick(jpeg());
      expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
      expect(tokens).toEqual([]);
      expect(session.auth.getAccessTokenFor).toHaveBeenCalledWith({ userId: OWNER.userId, email: OWNER.email });
      expect(screen.getByText("No cover photo yet")).toBeInTheDocument();
      expect(statusText()).toBe("");
    });

    it("someone else signed in mid-removal: refused, never sent as them", async () => {
      const session = switchableSession(OWNER);
      deleteOrganiserCover.mockImplementation((...args: unknown[]) => {
        session.become(OTHER);
        return callsTokenFirst(RECORD)(...args);
      });
      renderField(withCover, session);
      fireEvent.click(screen.getByRole("button", { name: "Remove cover photo" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
      expect(screen.getByRole("img", { name: "Your cover photo" })).toBeInTheDocument();
      expect(statusText()).toBe("");
    });

    it("already signed in as someone else when a photo is chosen or Remove pressed: refused without cropping or sending", () => {
      const session = switchableSession(OWNER);
      const { renderAs } = renderField(withCover, session);
      session.become(OTHER);
      renderAs(OTHER);
      pick(jpeg());
      expect(screen.getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fprofile");
      fireEvent.click(screen.getByRole("button", { name: "Remove cover photo" }));
      expect(screen.getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
      expect(prepareCoverImage).not.toHaveBeenCalled();
      expect(uploadOrganiserCover).not.toHaveBeenCalled();
      expect(deleteOrganiserCover).not.toHaveBeenCalled();
      expect(session.auth.getAccessTokenFor).not.toHaveBeenCalled();
    });
  });
});
