// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicProfileForm from "@/components/dashboard/PublicProfileForm";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const updateOrganiserProfile = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  updateOrganiserProfile: (...args: unknown[]) => updateOrganiserProfile(...args),
}));

let organiserState: { loading: boolean; organiser: OrganiserRecord | null; error: string | null };
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ ...organiserState, refetch: vi.fn() }),
}));

const RECORD: OrganiserRecord = {
  ownerUserId: "user-1",
  organiserId: "org-1",
  displayName: "Northside Noise",
  contactEmail: "org@example.com",
  description: "Loud nights in small rooms.",
  categories: ["live-music"],
  websiteUrl: "https://northside.example",
  instagramHandle: "northside.noise",
  tiktokHandle: "northside_noise",
  status: "approved",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

afterEach(cleanup);
beforeEach(() => {
  updateOrganiserProfile.mockReset();
  organiserState = { loading: false, organiser: RECORD, error: null };
});

const getToken = vi.fn().mockResolvedValue("token");

function renderForm(record: OrganiserRecord = RECORD) {
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <PublicProfileForm organiser={record} getToken={getToken} />
    </FakeAuthProvider>,
  );
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
}

function describedBy(element: HTMLElement): string {
  const ids = element.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" | ");
}

describe("PublicProfileForm", () => {
  it("starts from the saved profile", () => {
    renderForm();
    expect(screen.getByLabelText("Bio (required)")).toHaveValue("Loud nights in small rooms.");
    expect(screen.getByLabelText("Website (optional)")).toHaveValue("https://northside.example");
    expect(screen.getByLabelText("Instagram username")).toHaveValue("northside.noise");
    expect(screen.getByLabelText("TikTok username")).toHaveValue("northside_noise");
    expect(screen.getByLabelText("Facebook page")).toHaveValue("");
    expect(screen.getByLabelText("X username")).toHaveValue("");
    expect(describedBy(screen.getByLabelText("X username"))).toContain("without the @");
    expect(describedBy(screen.getByLabelText("Bio (required)"))).toContain("1,973 characters left");
  });

  it("flags an empty bio and a website without https://, focusing the first, without saving", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Bio (required)"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Website (optional)"), { target: { value: "northside.example" } });
    save();

    const bio = screen.getByLabelText("Bio (required)");
    await waitFor(() => expect(bio).toHaveFocus());
    expect(bio).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(bio)).toContain("Enter a bio.");
    const website = screen.getByLabelText("Website (optional)");
    expect(website).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(website)).toContain("Enter a valid URL, including https://");
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(updateOrganiserProfile).not.toHaveBeenCalled();
  });

  it("counts the bio down and refuses one over 2,000 characters", () => {
    renderForm();
    const bio = screen.getByLabelText("Bio (required)");
    fireEvent.change(bio, { target: { value: "a".repeat(2001) } });
    expect(describedBy(bio)).toContain("1 character too many");
    save();
    expect(describedBy(bio)).toContain("Your bio must be 2,000 characters or fewer.");
    expect(updateOrganiserProfile).not.toHaveBeenCalled();
  });

  it("sends only what changed, shows the stored values and announces success", async () => {
    let resolve: (record: OrganiserRecord) => void = () => {};
    updateOrganiserProfile.mockReturnValue(new Promise<OrganiserRecord>((r) => (resolve = r)));
    renderForm();

    fireEvent.change(screen.getByLabelText("Bio (required)"), { target: { value: "  New bio.  " } });
    fireEvent.change(screen.getByLabelText("X username"), { target: { value: " @nsnoise " } });
    save();

    expect(updateOrganiserProfile).toHaveBeenCalledTimes(1);
    expect(updateOrganiserProfile.mock.calls[0][0]).toEqual({ description: "New bio.", xHandle: "@nsnoise" });
    expect(updateOrganiserProfile.mock.calls[0][1]).toBe(getToken);
    const busy = screen.getByRole("button", { name: "Saving…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");

    resolve({ ...RECORD, description: "New bio.", xHandle: "nsnoise" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile saved."));
    expect(screen.getByLabelText("X username")).toHaveValue("nsnoise");
    expect(screen.getByRole("button", { name: "Save profile" })).not.toHaveAttribute("aria-disabled");
  });

  it("clears a website and handles that are emptied (sent as null)", async () => {
    updateOrganiserProfile.mockResolvedValue({ ...RECORD, websiteUrl: undefined, tiktokHandle: undefined });
    renderForm();

    fireEvent.change(screen.getByLabelText("Website (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("TikTok username"), { target: { value: "  " } });
    save();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile saved."));
    expect(updateOrganiserProfile.mock.calls[0][0]).toEqual({ websiteUrl: null, tiktokHandle: null });
    expect(screen.getByLabelText("TikTok username")).toHaveValue("");
  });

  it("doesn't call the API when nothing changed, and says so again on every press", async () => {
    renderForm();
    const status = screen.getByRole("status");
    save();
    await waitFor(() => expect(status).toHaveTextContent("No changes to save."));
    expect(updateOrganiserProfile).not.toHaveBeenCalled();

    // A live region only speaks when its text changes: a second press empties
    // it first, then fills it again, so it's heard again.
    save();
    expect(status).toBeEmptyDOMElement();
    await waitFor(() => expect(status).toHaveTextContent("No changes to save."));
    expect(screen.getByRole("status")).toBe(status); // the same region throughout
  });

  it("drops a pending 'No changes' message once something is edited", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      save();
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(screen.getByRole("status")).toHaveTextContent("No changes to save.");

      save();
      fireEvent.change(screen.getByLabelText("Bio (required)"), { target: { value: "Edited." } });
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the status region in the page (never display:none) while it's empty", () => {
    renderForm();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(status.className).not.toMatch(/(^|\s)(empty:)?hidden(\s|$)/);
    expect(status).toHaveClass("empty:sr-only");
  });

  it("marks the bio as required in its label", () => {
    renderForm();
    expect(screen.getByLabelText("Bio (required)")).toBeInTheDocument();
  });

  it("shows the handle limits in each hint", () => {
    renderForm();
    expect(describedBy(screen.getByLabelText("Instagram username"))).toContain("Letters, numbers, . and _, up to 30.");
    expect(describedBy(screen.getByLabelText("TikTok username"))).toContain("Letters, numbers, . and _, up to 30.");
    expect(describedBy(screen.getByLabelText("Facebook page"))).toContain("Letters, numbers and ., 5 to 50.");
    expect(describedBy(screen.getByLabelText("X username"))).toContain("Letters, numbers and _, up to 15.");
  });

  it("shows the server's field errors on their fields and keeps what was typed", async () => {
    updateOrganiserProfile.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", {
        instagramHandle: "Enter just your Instagram username.",
      }),
    );
    renderForm();
    const instagram = screen.getByLabelText("Instagram username");
    fireEvent.change(instagram, { target: { value: "northside noise" } });
    save();

    await waitFor(() => expect(instagram).toHaveFocus());
    expect(instagram).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(instagram)).toContain("Enter just your Instagram username.");
    expect(instagram).toHaveValue("northside noise");
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Bio (required)")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows other failures", async () => {
    updateOrganiserProfile.mockRejectedValue(new ApiError(409, "Your organiser status changed — refresh and try again."));
    renderForm();
    fireEvent.change(screen.getByLabelText("Bio (required)"), { target: { value: "Changed." } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your organiser status changed");
  });
});

describe("PublicProfileForm — website rule", () => {
  const SECURE = "Use your site's secure address, starting with https://";

  it.each([
    ["http://northside.example/new", SECURE],
    ["https://bank.example@evil.example", "Enter the address without a username or password."],
  ])("refuses a new website %s, focusing it, without saving", async (value, message) => {
    renderForm();
    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value } });
    save();
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAttribute("aria-invalid", "true");
    expect(website).toHaveAccessibleDescription(message);
    expect(updateOrganiserProfile).not.toHaveBeenCalled();
  });

  it("leaves a stored http:// website alone when it isn't changed, saving the rest", async () => {
    updateOrganiserProfile.mockResolvedValue({ ...RECORD, websiteUrl: "http://old.example", description: "New." });
    renderForm({ ...RECORD, websiteUrl: "http://old.example" });
    fireEvent.change(screen.getByLabelText("Bio (required)"), { target: { value: "New." } });
    save();
    await waitFor(() => expect(updateOrganiserProfile).toHaveBeenCalledTimes(1));
    expect(updateOrganiserProfile.mock.calls[0][0]).toEqual({ description: "New." });
    expect(screen.getByLabelText("Website (optional)")).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a stored http:// website once it's edited (still http://)", async () => {
    renderForm({ ...RECORD, websiteUrl: "http://old.example" });
    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value: "http://old.example/about" } });
    save();
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAccessibleDescription(SECURE);
    expect(updateOrganiserProfile).not.toHaveBeenCalled();
  });

  it("accepts the https:// version of a stored http:// website", async () => {
    updateOrganiserProfile.mockResolvedValue({ ...RECORD, websiteUrl: "https://old.example" });
    renderForm({ ...RECORD, websiteUrl: "http://old.example" });
    fireEvent.change(screen.getByLabelText("Website (optional)"), { target: { value: "https://old.example" } });
    save();
    await waitFor(() => expect(updateOrganiserProfile).toHaveBeenCalledTimes(1));
    expect(updateOrganiserProfile.mock.calls[0][0]).toEqual({ websiteUrl: "https://old.example" });
  });

  it("shows the server's website error on the field", async () => {
    updateOrganiserProfile.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { websiteUrl: SECURE }),
    );
    renderForm();
    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value: "https://northside.example/new" } });
    save();
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAttribute("aria-invalid", "true");
    expect(website).toHaveAccessibleDescription(SECURE);
    expect(website).toHaveValue("https://northside.example/new");
  });
});

describe("PublicProfilePanel", () => {
  function renderPanel() {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <PublicProfilePanel />
      </FakeAuthProvider>,
    );
  }

  it("links an approved organiser to their public profile, above the form", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "View public profile" })).toHaveAttribute("href", "/organisers/org-1");
    expect(screen.getByLabelText("Bio (required)")).toBeInTheDocument();
  });

  it("has no form until the organiser is approved", () => {
    organiserState = { loading: false, organiser: { ...RECORD, status: "pending" }, error: null };
    renderPanel();
    expect(screen.getByText(/goes live once your organiser application is approved/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Bio")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View public profile" })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in and back here", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <PublicProfilePanel />
      </FakeAuthProvider>,
    );
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fprofile");
    expect(signIn).toHaveClass("min-h-11");
  });

  it("gives its actions 44px targets", () => {
    organiserState = { loading: false, organiser: null, error: null };
    renderPanel();
    expect(screen.getByRole("link", { name: "Apply as an organiser" })).toHaveClass("min-h-11");
    cleanup();
    organiserState = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
    renderPanel();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("min-h-11");
  });

  it("shows loading and error states", () => {
    organiserState = { loading: true, organiser: null, error: null };
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    cleanup();
    organiserState = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
  });
});
