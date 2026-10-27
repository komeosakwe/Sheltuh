// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountContent from "@/components/account/AccountContent";
import { avatarFileError } from "@/components/account/AvatarField";
import MemberProfileSettings from "@/components/account/MemberProfileSettings";
import { ApiError } from "@/lib/api/client";
import type { ProfileRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
const updateMyProfile = vi.fn();
const uploadMyAvatar = vi.fn();
const deleteMyAvatar = vi.fn();
const deleteMyProfile = vi.fn();
const fetchAvatar = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfile(...args),
  saveMyProfile: vi.fn(),
  deleteMyProfile: (...args: unknown[]) => deleteMyProfile(...args),
  updateMyProfile: (...args: unknown[]) => updateMyProfile(...args),
  uploadMyAvatar: (...args: unknown[]) => uploadMyAvatar(...args),
  deleteMyAvatar: (...args: unknown[]) => deleteMyAvatar(...args),
  fetchAvatar: (...args: unknown[]) => fetchAvatar(...args),
}));
vi.mock("@/lib/api/organisers", () => ({
  getMyOrganiser: () => Promise.reject(new ApiError(404, "No organiser application.")),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

let blobCount = 0;
beforeEach(() => {
  for (const fn of [getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, deleteMyProfile, fetchAvatar]) fn.mockReset();
  blobCount = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${++blobCount}`),
    revokeObjectURL: vi.fn(),
  });
  fetchAvatar.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
});
afterEach(cleanup);

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  profileId: "pid-1",
  profileVisible: false,
  hasAvatar: false,
};

function renderSettings(profile: ProfileRecord = PROFILE, onSaved = vi.fn(), onMissing = vi.fn()) {
  const getToken = vi.fn().mockResolvedValue("t");
  render(<MemberProfileSettings profile={profile} getToken={getToken} onSaved={onSaved} onMissing={onMissing} />);
  return { onSaved, onMissing, getToken };
}

describe("member profile settings (/account)", () => {
  it("sits first on the account page in the Your profile card, off by default, with the delete wording updated", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <AccountContent />
      </FakeAuthProvider>,
    );
    const toggle = await screen.findByRole("checkbox", { name: "Show my profile to other members" });
    const section = screen.getByRole("region", { name: "Your profile" });
    expect(section).toContainElement(toggle);
    expect(section).toHaveAttribute("id", "member-profile");
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("link", { name: "Organisers you follow" })).toHaveAttribute("href", "/following");
    fireEvent.click(screen.getByRole("button", { name: "Delete your profile" }));
    expect(screen.getByText(/Removes your display name and member profile \(bio, Instagram and photo\)/)).toBeVisible();
  });

  it("explains the toggle in words, tied to the checkbox", () => {
    renderSettings();
    const toggle = screen.getByRole("checkbox", { name: "Show my profile to other members" });
    expect(toggle).toHaveAccessibleDescription(/Off by default\. .*your bio, Instagram, photo and upcoming events\. Never your email\./);
  });

  it("sends only what changed: visibility, bio, and a handle (a pasted link reduced to the name)", async () => {
    updateMyProfile.mockResolvedValue({ ...PROFILE, profileVisible: true, bio: "Hi", instagramHandle: "mia.t" });
    const { onSaved } = renderSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show my profile to other members" }));
    fireEvent.change(screen.getByLabelText("Bio (optional)"), { target: { value: "  Hi  " } });
    fireEvent.change(screen.getByLabelText("Instagram username (optional)"), {
      target: { value: "https://www.instagram.com/mia.t/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith(
        { profileVisible: true, bio: "Hi", instagramHandle: "mia.t" },
        expect.any(Function),
      ),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText(/Other members can now open your profile/)).toBeInTheDocument();
  });

  it("clears a bio or handle with null, and says when nothing changed", async () => {
    renderSettings({ ...PROFILE, bio: "Old", instagramHandle: "old" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(updateMyProfile).not.toHaveBeenCalled();
    updateMyProfile.mockResolvedValue(PROFILE);
    fireEvent.change(screen.getByLabelText("Bio (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Instagram username (optional)"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith({ bio: null, instagramHandle: null }, expect.any(Function)));
  });

  it("counts the bio down from 200 and refuses more, focused, before sending", async () => {
    renderSettings();
    const bio = screen.getByLabelText("Bio (optional)");
    fireEvent.change(bio, { target: { value: "x".repeat(201) } });
    expect(screen.getByText("1 characters too many")).toHaveClass("text-danger");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(bio).toHaveFocus());
    expect(bio).toHaveAttribute("aria-invalid", "true");
    expect(bio).toHaveAccessibleDescription(/Your bio must be 200 characters or fewer\./);
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("puts the API's field error on its field (focused)", async () => {
    updateMyProfile.mockRejectedValue(
      new ApiError(400, "Fix the highlighted fields.", { instagramHandle: "That isn't an Instagram username." }),
    );
    renderSettings();
    const handle = screen.getByLabelText("Instagram username (optional)");
    fireEvent.change(handle, { target: { value: "no spaces allowed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(handle).toHaveFocus());
    expect(handle).toHaveAccessibleDescription(/That isn't an Instagram username\./);
  });

  it("says why it can't save (403 unverified), as an alert", async () => {
    updateMyProfile.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show my profile to other members" }));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email address first.");
  });

  it("a suspended profile can't be changed", () => {
    renderSettings({ ...PROFILE, suspended: true });
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.getByText(/Suspended profiles can’t be changed/)).toBeInTheDocument();
  });

  it("links to the profile as members see it once it's visible", () => {
    renderSettings({ ...PROFILE, profileVisible: true });
    expect(screen.getByRole("link", { name: "See your profile as members see it" })).toHaveAttribute("href", "/members/pid-1");
  });
});

describe("profile photo", () => {
  function pick(file: File) {
    fireEvent.change(screen.getByLabelText(/Photo \(optional\)/), { target: { files: [file] } });
  }

  it("checks type and size before sending anything", () => {
    expect(avatarFileError(new File(["x"], "a.gif", { type: "image/gif" }))).toBe("Choose a JPEG, PNG or WebP photo.");
    const big = new File(["x"], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 });
    expect(avatarFileError(big)).toMatch(/over 5 MB/);
    expect(avatarFileError(new File(["x"], "a.webp", { type: "image/webp" }))).toBeNull();

    renderSettings();
    pick(new File(["x"], "a.heic", { type: "image/heic" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG or WebP photo.");
    expect(uploadMyAvatar).not.toHaveBeenCalled();
  });

  it("the picker is a real file input, named, described, styled as a button", () => {
    renderSettings();
    const input = screen.getByLabelText(/Photo \(optional\)/);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAccessibleName("Photo (optional) Choose a photo");
    expect(input).toHaveAccessibleDescription(/Camera and location data removed\./);
  });

  it("previews the chosen photo while it uploads, says so, then saves", async () => {
    let resolve: (p: ProfileRecord) => void = () => {};
    uploadMyAvatar.mockReturnValue(new Promise<ProfileRecord>((r) => (resolve = r)));
    const { onSaved } = renderSettings();
    const file = new File(["x"], "me.jpg", { type: "image/jpeg" });
    pick(file);
    expect(uploadMyAvatar).toHaveBeenCalledWith(file, expect.any(Function));
    expect(screen.getByRole("img", { name: "Your new photo, uploading" })).toHaveAttribute("src", "blob:1");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Uploading your photo…")).toBe(true);
    resolve({ ...PROFILE, hasAvatar: true, avatarUrl: "/api/profiles/me/avatar?v=2" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ hasAvatar: true })));
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Photo saved.")).toBe(true);
    // The preview is revoked by an effect cleanup after the busy state clears, a render after onSaved.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1"));
  });

  it("explains a refused upload (413)", async () => {
    uploadMyAvatar.mockRejectedValue(new ApiError(413, "Too large."));
    renderSettings();
    pick(new File(["x"], "me.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That photo is over 5 MB.");
  });

  it("shows the saved photo (fetched with the token) and removes it", async () => {
    deleteMyAvatar.mockResolvedValue(undefined);
    const { onSaved } = renderSettings({ ...PROFILE, hasAvatar: true, avatarUrl: "/api/profiles/me/avatar?v=1" });
    expect(await screen.findByRole("img", { name: "Your profile photo" })).toHaveAttribute("src", "blob:1");
    expect(screen.getByLabelText(/Photo \(optional\)/)).toHaveAccessibleName("Photo (optional) Change photo");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(deleteMyAvatar).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ hasAvatar: false })));
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Photo removed.")).toBe(true);
  });
});
