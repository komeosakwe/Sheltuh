// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserLogoField, { logoErrorMessage, logoFileError } from "@/components/dashboard/OrganiserLogoField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { ImageError } from "@/lib/image";

const uploadOrganiserLogo = vi.fn();
const deleteOrganiserLogo = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  uploadOrganiserLogo: (...args: unknown[]) => uploadOrganiserLogo(...args),
  deleteOrganiserLogo: (...args: unknown[]) => deleteOrganiserLogo(...args),
}));
const prepareEventImage = vi.fn();
vi.mock("@/lib/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image")>()),
  prepareEventImage: (...args: unknown[]) => prepareEventImage(...args),
}));

const LOGO_URL = "/api/organisers/org-1/logo?v=1730000000000";
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
/** What lib/image.ts hands back: the shrunk image that's actually sent. */
const PREPARED = new Blob(["shrunk"], { type: "image/jpeg" });

let blobCount = 0;
beforeEach(() => {
  for (const fn of [uploadOrganiserLogo, deleteOrganiserLogo, prepareEventImage]) fn.mockReset();
  prepareEventImage.mockResolvedValue(PREPARED);
  blobCount = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${++blobCount}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(cleanup);

const getToken = vi.fn().mockResolvedValue("t");

function renderField(record: OrganiserRecord = RECORD) {
  return render(<OrganiserLogoField organiser={record} getToken={getToken} />);
}

function picker(): HTMLElement {
  return screen.getByLabelText(/Logo \(optional\)/);
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

const png = () => new File(["x"], "logo.png", { type: "image/png" });

describe("OrganiserLogoField", () => {
  it("starts empty: a placeholder, a named file picker styled as a button, the rules, and no Remove", () => {
    renderField();
    expect(screen.getByText("No logo yet")).toBeInTheDocument();
    const input = picker();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAccessibleName("Logo (optional) Choose a logo");
    expect(screen.getByText("Choose a logo")).toHaveClass("min-h-11");
    const hint = input.getAttribute("aria-describedby");
    expect(hint).toBe("organiser-logo-hint");
    expect(input).toHaveAccessibleDescription(/It’s public/);
    expect(input).toHaveAccessibleDescription(/on a white square, so a square logo fills it best/);
    expect(input).toHaveAccessibleDescription(/remove everything stored in the file/);
    expect(input).toHaveAccessibleDescription(/Only upload a logo you have the rights to use\./);
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
  });

  it("checks the type before shrinking or sending anything", () => {
    expect(logoFileError(new File(["x"], "a.gif", { type: "image/gif" }))).toBe("Choose a JPEG, PNG or WebP image.");
    expect(logoFileError(new File([], "a.png", { type: "image/png" }))).toMatch(/empty/);
    expect(logoFileError(png())).toBeNull();

    renderField();
    pick(new File(["x"], "a.heic", { type: "image/heic" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG or WebP image.");
    expect(prepareEventImage).not.toHaveBeenCalled();
    expect(uploadOrganiserLogo).not.toHaveBeenCalled();
  });

  it("shrinks the image, previews it while it uploads, then shows the stored logo", async () => {
    let resolve: (record: OrganiserRecord) => void = () => {};
    uploadOrganiserLogo.mockReturnValue(new Promise<OrganiserRecord>((r) => (resolve = r)));
    const { container } = renderField();
    const file = png();
    pick(file);

    expect(screen.getByRole("img", { name: "Your new logo, uploading" })).toHaveAttribute("src", "blob:1");
    expect(statusText()).toContain("Uploading your logo…");
    expect(container.querySelector("[data-organiser-logo-field]")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(uploadOrganiserLogo).toHaveBeenCalledWith(PREPARED, getToken));
    expect(prepareEventImage).toHaveBeenCalledWith(file);
    // A second pick while one is uploading is ignored (the picker stays focusable).
    expect(picker()).toHaveAttribute("aria-disabled", "true");
    pick(png());
    expect(prepareEventImage).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ ...RECORD, logoUrl: LOGO_URL }));
    expect(screen.getByRole("img", { name: "Your logo" })).toHaveAttribute("src", LOGO_URL);
    expect(statusText()).toContain("Logo saved. It’s on your public profile now.");
    expect(picker()).toHaveAccessibleName("Logo (optional) Change logo");
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeInTheDocument();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1"));
  });

  it.each([
    [new ApiError(413, "Too large."), "That image is over 2 MB, even after shrinking it. Choose a smaller one."],
    [new ApiError(429, "Slow down."), "You’ve changed your logo a lot today. Try again tomorrow."],
    [new ApiError(409, "Conflict."), "Your organiser profile changed while the logo was uploading, so it wasn’t saved."],
    [new ApiError(403, "Forbidden."), "Only approved organisers can add a logo."],
    [
      new ApiError(400, "Invalid.", { logo: "That file isn't a JPEG, PNG or WebP image." }),
      "That file isn't a JPEG, PNG or WebP image.",
    ],
    [new ApiError(400, "Invalid."), "We couldn’t use that file. Choose a JPEG, PNG or WebP image."],
    [new ApiError(503, "Busy."), "We’re busy processing images right now. Try again in a minute."],
    [
      new ApiError(0, "Couldn't reach the server. Check your connection and try again."),
      "Couldn't reach the server. Check your connection and try again.",
    ],
    [new ApiError(500, "Boom."), "Couldn’t upload that logo. Try again."],
  ])("explains a refused upload (%s)", async (err, message) => {
    uploadOrganiserLogo.mockRejectedValue(err);
    renderField();
    pick(png());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    // Nothing changed: still the empty placeholder, and the status says nothing stale.
    expect(screen.getByText("No logo yet")).toBeInTheDocument();
    expect(statusText()).toBe("");
  });

  it("says what's wrong when the image can't be shrunk, without sending it", async () => {
    prepareEventImage.mockRejectedValue(new ImageError("That image is too large. Choose one under 2 MB."));
    renderField();
    pick(png());
    expect(await screen.findByRole("alert")).toHaveTextContent("That image is too large. Choose one under 2 MB.");
    expect(uploadOrganiserLogo).not.toHaveBeenCalled();
  });

  it("an expired session offers Sign in, back to the profile page", async () => {
    uploadOrganiserLogo.mockRejectedValue(new SessionExpiredError());
    renderField();
    pick(png());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fprofile");
  });

  it("shows the saved logo and removes it, returning focus to the picker", async () => {
    deleteOrganiserLogo.mockResolvedValue({ ...RECORD });
    renderField({ ...RECORD, logoUrl: LOGO_URL });
    expect(screen.getByRole("img", { name: "Your logo" })).toHaveAttribute("src", LOGO_URL);
    expect(picker()).toHaveAccessibleName("Logo (optional) Change logo");

    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    await waitFor(() => expect(deleteOrganiserLogo).toHaveBeenCalledWith(getToken));
    await waitFor(() => expect(screen.getByText("No logo yet")).toBeInTheDocument());
    expect(statusText()).toContain("Logo removed.");
    expect(picker()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
  });

  it("keeps the logo when removing fails, and says so", async () => {
    deleteOrganiserLogo.mockRejectedValue(new ApiError(500, "Boom."));
    renderField({ ...RECORD, logoUrl: LOGO_URL });
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t remove your logo. Try again.");
    expect(screen.getByRole("img", { name: "Your logo" })).toBeInTheDocument();
  });

  it("says when the saved logo can't be shown, and still offers Remove", () => {
    renderField({ ...RECORD, logoUrl: LOGO_URL });
    act(() => {
      screen.getByRole("img", { name: "Your logo" }).dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("Couldn’t show your logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeInTheDocument();
  });
});

describe("logoErrorMessage", () => {
  it("treats a refused token (401) like an expired session: signing in helps, trying again doesn't", () => {
    expect(logoErrorMessage(new ApiError(401, "Unauthorized"), "fallback")).toBe(SESSION_EXPIRED_MESSAGE);
  });
});
