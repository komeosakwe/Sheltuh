// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountContent from "@/components/account/AccountContent";
import { ApiError } from "@/lib/api/client";
import type { ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
const saveMyProfile = vi.fn();
const deleteMyProfile = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfile(...args),
  saveMyProfile: (...args: unknown[]) => saveMyProfile(...args),
  deleteMyProfile: (...args: unknown[]) => deleteMyProfile(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  getMyProfile.mockReset();
  saveMyProfile.mockReset();
  deleteMyProfile.mockReset();
});

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

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
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete profile" })).toBeNull();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("signed out: offers sign in, returning here", () => {
    renderAccount(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByText("Sign in to manage your account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Faccount");
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("no profile yet: says it's created on first opt-in, with no form or delete", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
    renderAccount();
    expect(screen.getByText("mia@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/Your profile is created the first time you do\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete profile" })).toBeNull();
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

    saveMyProfile.mockRejectedValueOnce(
      new ApiError(400, "Invalid input.", { displayName: "Display names can't include links, email addresses or @handles." }),
    );
    fireEvent.change(input, { target: { value: "mia.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(expect.stringContaining("can't include links"));
    expect(input).toHaveFocus();

    saveMyProfile.mockResolvedValueOnce({ ...PROFILE, displayName: "Mia Thompson" });
    fireEvent.change(input, { target: { value: " Mia Thompson " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved. Events you’ve joined now show Mia Thompson."),
    );
    expect(saveMyProfile).toHaveBeenLastCalledWith({ displayName: "Mia Thompson" }, expect.any(Function));

    // The confirmation goes once the name is edited again.
    fireEvent.change(input, { target: { value: "Mia T" } });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("validates the name before saving", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const input = await screen.findByLabelText("Display name");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(input).toHaveAccessibleDescription(expect.stringContaining("Enter a display name."));
    expect(saveMyProfile).not.toHaveBeenCalled();
  });

  it("deletes the profile after an inline confirm, with focus handled throughout", async () => {
    getMyProfile.mockResolvedValue(PROFILE);
    renderAccount();
    const del = await screen.findByRole("button", { name: "Delete profile" });

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
    const done = await screen.findByText("Your profile is deleted. You’re no longer shown on any event.");
    expect(done.closest("[tabindex='-1']")).toHaveFocus();
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(deleteMyProfile).toHaveBeenCalledTimes(2);
  });
});
