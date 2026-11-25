// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage, { metadata } from "@/app/(account)/profile/page";
import { ApiError } from "@/lib/api/client";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * /profile, the account area's Profile tab: the Your profile card Settings shows (set up or
 * edited here), "See your public profile" once other members can open it, a sign-in that comes
 * back here, and the demo's disabled sample. The API is stubbed at lib/api/profiles.
 */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
const saveMyProfile = vi.fn();
const updateMyProfile = vi.fn();
const uploadMyAvatar = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfile(...args),
  saveMyProfile: (...args: unknown[]) => saveMyProfile(...args),
  updateMyProfile: (...args: unknown[]) => updateMyProfile(...args),
  uploadMyAvatar: (...args: unknown[]) => uploadMyAvatar(...args),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
beforeEach(() => {
  getMyProfile.mockReset();
  saveMyProfile.mockReset();
  updateMyProfile.mockReset();
  uploadMyAvatar.mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:1"), revokeObjectURL: vi.fn() });
});

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  profileId: "pid-1",
  profileVisible: false,
};

function renderProfile(auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <ProfilePage />
    </FakeAuthProvider>,
  );
}

const publicLink = () => screen.queryByRole("link", { name: "See your public profile" });

describe("/profile", () => {
  it("is titled Profile, with the page's line", () => {
    expect(metadata.title).toBe("Profile — Sheltüh");
    getMyProfile.mockResolvedValue(PROFILE);
    renderProfile();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("How you show on Who’s Going lists.")).toBeInTheDocument();
  });

  it("demo: the disabled sample card and no API calls", () => {
    renderProfile(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Accounts aren’t available in this demo.");
    expect(screen.getByRole("heading", { level: 2, name: "Your profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(publicLink()).toBeNull();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("signed out: offers sign in, returning to /profile", () => {
    renderProfile(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByText("Sign in to edit your profile")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprofile");
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("waits for the session: no sign-in prompt and no card yet", () => {
    renderProfile(fakeAuthValue({ status: "loading", email: undefined }));
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your profile" })).toBeNull();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("no profile yet: the create form, and no public profile to see", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    renderProfile();
    expect(await screen.findByText("No profile yet.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create your Who's Going profile" })).toBeInTheDocument();
    expect(publicLink()).toBeNull();
    // Settings' other cards stay on Settings.
    expect(screen.queryByRole("region", { name: "Sign-in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete your profile" })).toBeNull();
  });

  it("creates a profile here, and says how they'll be shown", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    saveMyProfile.mockResolvedValueOnce(PROFILE);
    renderProfile();
    const form = await screen.findByRole("form", { name: "Create your Who's Going profile" });
    fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "Mia T." } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    const done = await screen.findByText("You’ll be shown as Mia T.");
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    expect(saveMyProfile).toHaveBeenCalledWith({ displayName: "Mia T.", adultConfirmed: true }, expect.any(Function));
  });

  it("a hidden profile: the edit form, and no public profile to see", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderProfile();
    expect(await screen.findByRole("form", { name: "Your profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Mia T.");
    expect(publicLink()).toBeNull();
  });

  it("a visible profile: See your public profile goes to the member page, and the card doesn't repeat it", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, profileVisible: true });
    renderProfile();
    expect(await screen.findByRole("link", { name: "See your public profile" })).toHaveAttribute("href", "/members/pid-1");
    expect(screen.getAllByRole("link", { name: /profile as members see it|public profile/ })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "See your profile as members see it" })).toBeNull();
  });

  it("a suspended member: no public profile link (their page is a 404 while suspended)", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, profileVisible: true, suspended: true });
    renderProfile();
    expect(await screen.findByText("Suspended profiles can’t be changed or shown to other members.")).toBeInTheDocument();
    expect(publicLink()).toBeNull();
  });

  it("shows a load failure with Try again, which loads it again", async () => {
    getMyProfile.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce(PROFILE);
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your profile.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("form", { name: "Your profile" })).toBeInTheDocument();
    expect(getMyProfile).toHaveBeenCalledTimes(2);
  });

  it("offers Sign in, back to /profile, when the session has expired", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    updateMyProfile.mockRejectedValueOnce(new SessionExpiredError());
    renderProfile();
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Mia" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to continue.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprofile");
  });

  it("offers Sign in, back to /profile, when creating a profile finds the session expired", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    saveMyProfile.mockRejectedValueOnce(new SessionExpiredError());
    renderProfile();
    const form = await screen.findByRole("form", { name: "Create your Who's Going profile" });
    fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "Mia T." } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to continue.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprofile");
  });

  it("offers Sign in, back to the card on /profile, when a photo upload finds the session expired", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    uploadMyAvatar.mockRejectedValueOnce(new SessionExpiredError());
    renderProfile();
    await screen.findByRole("form", { name: "Your profile" });
    fireEvent.change(screen.getByLabelText(/Photo \(optional\)/), {
      target: { files: [new File(["x"], "me.png", { type: "image/png" })] },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your session has expired.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fprofile%23member-profile",
    );
  });

  it("back from signing in to #member-profile: focuses the card once it has loaded", async () => {
    window.history.replaceState(null, "", "/profile#member-profile");
    getMyProfile.mockResolvedValue(PROFILE);
    renderProfile();
    await screen.findByRole("form", { name: "Your profile" });
    await waitFor(() => expect(screen.getByRole("region", { name: "Your profile" })).toHaveFocus());
  });

  it("without the anchor, leaves focus where it is", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderProfile();
    await screen.findByRole("form", { name: "Your profile" });
    expect(screen.getByRole("region", { name: "Your profile" })).not.toHaveFocus();
  });
});
