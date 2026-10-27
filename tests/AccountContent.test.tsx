// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountContent from "@/components/account/AccountContent";
import { ApiError } from "@/lib/api/client";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
const saveMyProfile = vi.fn();
const updateMyProfile = vi.fn();
const deleteMyProfile = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfile(...args),
  saveMyProfile: (...args: unknown[]) => saveMyProfile(...args),
  updateMyProfile: (...args: unknown[]) => updateMyProfile(...args),
  deleteMyProfile: (...args: unknown[]) => deleteMyProfile(...args),
}));
const getMyOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  getMyOrganiser: (...args: unknown[]) => getMyOrganiser(...args),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  getMyProfile.mockReset();
  saveMyProfile.mockReset();
  updateMyProfile.mockReset();
  deleteMyProfile.mockReset();
  getMyOrganiser.mockReset();
  // Not an organiser unless a test says so.
  getMyOrganiser.mockRejectedValue(new ApiError(404, "No organiser application."));
});

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** The profile form's own status line (the photo has its own too). */
function renameStatus() {
  return within(screen.getByRole("form", { name: "Your profile" })).getByRole("status");
}

/** Opens "Delete your profile" (a disclosure, closed at first). */
async function openDelete() {
  const disclosure = await screen.findByRole("button", { name: "Delete your profile" });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Delete profile" })).toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  return screen.getByRole("button", { name: "Delete profile" });
}

function renderAccount(auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <AccountContent />
    </FakeAuthProvider>,
  );
}

describe("AccountContent", () => {
  it("demo: explains accounts aren't available, with a disabled sample form and no API calls", () => {
    renderAccount(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Accounts aren’t available in this demo.");
    expect(screen.getByLabelText("Display name")).toHaveValue("Mia T.");
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete your profile" })).toBeNull();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("signed out: offers sign in, returning here", () => {
    renderAccount(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByText("Sign in to manage your account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Faccount");
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("no profile yet: offers to create one (name + 18+), and nothing to delete", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    renderAccount();
    expect(screen.getByText("mia@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/You haven’t set up a profile yet\./)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Create your Who's Going profile" });
    expect(within(form).getByLabelText("Display name")).toHaveValue("");
    expect(within(form).getByRole("checkbox", { name: "I’m 18 or older" })).not.toBeChecked();
    expect(within(form).getByRole("link", { name: "How we handle your information" })).toHaveAttribute(
      "href",
      "/privacy#whos-going",
    );
    expect(screen.queryByRole("button", { name: "Delete your profile" })).toBeNull();
    // Deleting the whole account is still explained.
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("creates a profile: validates first, sends the 18+ confirmation, then shows and focuses the result", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    renderAccount();
    const form = await screen.findByRole("form", { name: "Create your Who's Going profile" });
    const input = within(form).getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Mia T." } });
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    const adult = within(form).getByRole("checkbox", { name: "I’m 18 or older" });
    expect(adult).toHaveAccessibleDescription("Confirm you're 18 or older to be shown.");
    expect(adult).toHaveFocus();
    expect(saveMyProfile).not.toHaveBeenCalled();

    saveMyProfile.mockResolvedValueOnce(PROFILE);
    fireEvent.click(adult);
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    const done = await screen.findByText("Your profile is set up. You’ll be shown as Mia T.");
    // Focus moves in an effect after the swap to the saved profile, so allow it to settle.
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    expect(saveMyProfile).toHaveBeenCalledWith({ displayName: "Mia T.", adultConfirmed: true }, expect.any(Function));
    expect(screen.getByRole("button", { name: "Save profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete your profile" })).toBeInTheDocument();
  });

  it("shows why creating is refused (suspended: 403) and the API's name error on the field", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    renderAccount();
    const form = await screen.findByRole("form", { name: "Create your Who's Going profile" });
    const input = within(form).getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Mia" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));

    saveMyProfile.mockRejectedValueOnce(new ApiError(403, "Your profile can't be changed right now."));
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Your profile can't be changed right now.");

    saveMyProfile.mockRejectedValueOnce(
      new ApiError(400, "Invalid input.", { displayName: "Display names can't mix Latin, Cyrillic or Greek letters in one word." }),
    );
    fireEvent.click(within(form).getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(input).toHaveAccessibleDescription(expect.stringContaining("can't mix Latin")));
    expect(input).toHaveFocus();
  });

  it("renaming a profile that has gone (404) switches to setting one up, with focus on why", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const input = await screen.findByLabelText("Display name");
    updateMyProfile.mockRejectedValueOnce(new ApiError(404, "You haven't set up a profile yet."));
    fireEvent.change(input, { target: { value: "Mia Thompson" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const message = await screen.findByText(/You haven’t set up a profile yet\./);
    await waitFor(() => expect(message.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.getByRole("form", { name: "Create your Who's Going profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete your profile" })).toBeNull();
  });

  it("shows a load error with Try again", async () => {
    getMyProfile.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce(PROFILE);
    renderAccount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your profile.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Display name")).toHaveValue("Mia T.");
  });

  it("renames, confirming in a status message; the API's field error shows on the field", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const input = await screen.findByLabelText("Display name");

    updateMyProfile.mockRejectedValueOnce(
      new ApiError(400, "Invalid input.", { displayName: "Display names can't include links, email addresses or @handles." }),
    );
    fireEvent.change(input, { target: { value: "mia.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(expect.stringContaining("can't include links"));
    expect(input).toHaveFocus();

    updateMyProfile.mockResolvedValueOnce({ ...PROFILE, displayName: "Mia Thompson" });
    fireEvent.change(input, { target: { value: " Mia Thompson " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(renameStatus()).toHaveTextContent(/^Saved\. Events you’ve joined now show Mia Thompson\.$/),
    );
    // Only the name changed, so only the name is sent.
    expect(updateMyProfile).toHaveBeenLastCalledWith({ displayName: "Mia Thompson" }, expect.any(Function));
    expect(saveMyProfile).not.toHaveBeenCalled();

    // The confirmation goes once the name is edited again.
    fireEvent.change(input, { target: { value: "Mia T" } });
    expect(renameStatus()).toBeEmptyDOMElement();
  });

  it("validates the name before saving", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const input = await screen.findByLabelText("Display name");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("Enter a display name."));
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("deletes the profile after an inline confirm, with focus handled throughout", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const del = await openDelete();

    fireEvent.click(del);
    expect(screen.getByRole("group", { name: "Delete your Who’s Going profile?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete profile" })).toHaveFocus();

    deleteMyProfile.mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete your profile. Try again.");
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeEnabled();

    deleteMyProfile.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    const done = await screen.findByText(
      "Your profile is deleted. You’re no longer shown on any event, and your conversations are gone.",
    );
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(deleteMyProfile).toHaveBeenCalledTimes(2);
  });

  it("signs out from here (the nav no longer has Sign out) and links an organiser to Your events", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    getMyOrganiser.mockResolvedValue({ organiserId: "o1", displayName: "Northside Noise", status: "approved" });
    const auth = fakeAuthValue({ email: "mia@example.com" });
    renderAccount(auth);
    const links = screen.getByRole("navigation", { name: "Your account" });
    expect(await within(links).findByRole("link", { name: "Your events" })).toHaveAttribute("href", "/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // No scope: the default, global sign-out (every device), which is also what marks it as the
    // person's own, so no tab keeps a form on screen for it.
    expect(auth.signOut).toHaveBeenCalledWith();
    expect(push).toHaveBeenCalledWith("/");
    await screen.findByLabelText("Display name");
  });

  it("says how the account signs in (Supabase's providers), as text, in a fixed order", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount(fakeAuthValue({ email: "mia@example.com", providers: ["google", "email"] }));
    expect(screen.getByText("Sign-in methods: Email and password, Google")).toBeInTheDocument();
    await screen.findByLabelText("Display name");
    cleanup();

    renderAccount(fakeAuthValue({ email: "x@privaterelay.appleid.com", providers: ["apple"] }));
    expect(screen.getByText("Sign-in methods: Apple")).toBeInTheDocument();
    await screen.findByLabelText("Display name");
  });

  it("leaves the sign-in methods line out when they aren't known", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount(fakeAuthValue({ email: "mia@example.com", providers: ["github"] }));
    await screen.findByLabelText("Display name");
    expect(screen.queryByText(/^Sign-in methods:/)).toBeNull();
    cleanup();
    renderAccount(fakeAuthValue({ email: "mia@example.com" }));
    await screen.findByLabelText("Display name");
    expect(screen.queryByText(/^Sign-in methods:/)).toBeNull();
  });

  it("keeps focus on Save profile while saving (busy, not disabled), and after it's saved", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const input = await screen.findByLabelText("Display name");
    let resolve: (profile: ProfileRecord) => void = () => {};
    updateMyProfile.mockReturnValueOnce(new Promise<ProfileRecord>((r) => (resolve = r)));

    fireEvent.change(input, { target: { value: "Mia Thompson" } });
    const save = screen.getByRole("button", { name: "Save profile" });
    save.focus();
    fireEvent.click(save);
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBe(save);
    expect(saving).not.toBeDisabled(); // `disabled` would drop focus to the page
    expect(saving).toHaveAttribute("aria-disabled", "true");
    expect(saving).toHaveFocus();
    fireEvent.click(saving); // ignored while busy
    expect(updateMyProfile).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ ...PROFILE, displayName: "Mia T." }));
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-disabled");
    // The name's own full stop isn't doubled.
    expect(renameStatus()).toHaveTextContent(/^Saved\. Events you’ve joined now show Mia T\.$/);
  });

  it("keeps focus on Yes, delete when deleting fails, so it can be retried", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    fireEvent.click(await openDelete());
    let reject: (err: unknown) => void = () => {};
    deleteMyProfile.mockReturnValueOnce(new Promise((_, rj) => (reject = rj)));

    const yes = screen.getByRole("button", { name: "Yes, delete" });
    yes.focus();
    fireEvent.click(yes);
    const deleting = screen.getByRole("button", { name: "Deleting…" });
    expect(deleting).not.toBeDisabled();
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => reject(new ApiError(500, "boom")));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete your profile. Try again.");
    expect(screen.getByRole("button", { name: "Yes, delete" })).toHaveFocus();
  });

  it("offers Sign in, back to /account, when the session has expired", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    updateMyProfile.mockRejectedValueOnce(new SessionExpiredError());
    renderAccount();
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Mia" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to continue.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Faccount");
  });

  it("tells a suspended member their name is hidden, with the support address", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, suspended: true });
    renderAccount();
    const notice = await screen.findByText(/Your display name is hidden from Who’s Going\./);
    expect(within(notice).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute(
      "href",
      "mailto:support@sheltuh.com.au",
    );
  });

  it("puts the profile first, then the link rows, Sign-in, and Delete your profile last", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount(fakeAuthValue({ email: "mia@example.com", providers: ["email"] }));
    await screen.findByLabelText("Display name");
    const profile = screen.getByRole("region", { name: "Your profile" });
    const order = [
      profile,
      screen.getByRole("navigation", { name: "Your account" }),
      screen.getByRole("region", { name: "Sign-in" }),
      screen.getByRole("button", { name: "Delete your profile" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The profile card holds the photo, name, bio, Instagram and the switch, with one Save.
    within(profile).getByLabelText(/Photo \(optional\)/);
    within(profile).getByLabelText("Display name");
    within(profile).getByLabelText("Bio (optional)");
    within(profile).getByLabelText("Instagram username (optional)");
    within(profile).getByRole("checkbox", { name: "Show my profile to other members" });
    expect(within(profile).getAllByRole("button", { name: /^Save/ })).toHaveLength(1);
    expect(within(profile).getByRole("link", { name: "How we handle your information" })).toHaveAttribute(
      "href",
      "/privacy#whos-going",
    );
    const sign = screen.getByRole("region", { name: "Sign-in" });
    expect(within(sign).getByText("mia@example.com")).toBeInTheDocument();
    expect(within(sign).getByText("Sign-in methods: Email and password")).toBeInTheDocument();
    expect(within(sign).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("lists Organisers you follow, Messages and Blocked members; Your events only for an organiser, Organise events otherwise", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    await screen.findByLabelText("Display name");
    await waitFor(() => expect(getMyOrganiser).toHaveBeenCalled());
    const links = screen.getByRole("navigation", { name: "Your account" });
    // Not an organiser: the way to become one.
    await within(links).findByRole("link", { name: "Organise events" });
    expect(within(links).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Organise events", "/organisers/apply"],
      ["Organisers you follow", "/following"],
      ["Messages", "/messages"],
      ["Blocked members", "/messages/blocked"],
    ]);
    expect(within(links).queryByRole("link", { name: "Your events" })).toBeNull();
    cleanup();

    // Couldn't tell (not a 404): the row stays, and the dashboard explains itself.
    getMyOrganiser.mockReset();
    getMyOrganiser.mockRejectedValue(new ApiError(500, "boom"));
    renderAccount();
    const again = screen.getByRole("navigation", { name: "Your account" });
    expect(await within(again).findByRole("link", { name: "Your events" })).toHaveAttribute("href", "/dashboard");
    expect(within(again).queryByRole("link", { name: "Organise events" })).toBeNull();
    await screen.findByLabelText("Display name");
  });

  it("saves the name and the rest in one press (one request), with the API's errors on each field", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, profileId: "pid-1", profileVisible: false });
    renderAccount();
    const name = await screen.findByLabelText("Display name");
    const bio = screen.getByLabelText("Bio (optional)");
    fireEvent.change(name, { target: { value: "mia.com" } });
    fireEvent.change(bio, { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show my profile to other members" }));

    updateMyProfile.mockRejectedValueOnce(
      new ApiError(400, "Fix the highlighted fields.", {
        displayName: "Display names can't include links, email addresses or @handles.",
        bio: "Bios can't include that.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(expect.stringContaining("can't include links"));
    expect(bio).toHaveAttribute("aria-invalid", "true");
    expect(bio).toHaveAccessibleDescription(expect.stringContaining("Bios can't include that."));
    expect(updateMyProfile).toHaveBeenCalledWith(
      { displayName: "mia.com", profileVisible: true, bio: "Hi" },
      expect.any(Function),
    );

    updateMyProfile.mockResolvedValueOnce({ ...PROFILE, displayName: "Mia Thompson", profileVisible: true, bio: "Hi" });
    fireEvent.change(name, { target: { value: "Mia Thompson" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(renameStatus()).toHaveTextContent(
        "Saved. Events you’ve joined now show Mia Thompson. Other members can now open your profile from Who’s Going lists.",
      ),
    );
    expect(updateMyProfile).toHaveBeenCalledTimes(2);
    expect(updateMyProfile).toHaveBeenLastCalledWith(
      { displayName: "Mia Thompson", profileVisible: true, bio: "Hi" },
      expect.any(Function),
    );
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(bio).not.toHaveAttribute("aria-invalid");
  });
});
