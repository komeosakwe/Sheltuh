// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserQueue from "@/components/admin/OrganiserQueue";
import ReportQueue from "@/components/admin/ReportQueue";
import type { AdminOrganiserRecord, AdminReport } from "@/lib/api/types";
import type { AdminListOrganisersQuery } from "@/lib/api/admin";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { fakeUrl } from "./test-utils/fakeUrl";

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListReports = vi.fn();
const adminGetMemberProfile = vi.fn();
const adminRemoveProfileContent = vi.fn();
const adminListOrganisers = vi.fn();
const adminRemoveFeaturedVideo = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListReports: (...args: unknown[]) => adminListReports(...args),
  adminResolveReport: vi.fn(),
  adminGetMemberProfile: (...args: unknown[]) => adminGetMemberProfile(...args),
  adminRemoveProfileContent: (...args: unknown[]) => adminRemoveProfileContent(...args),
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
  adminApproveOrganiser: vi.fn(),
  adminRejectOrganiser: vi.fn(),
  adminSuspendOrganiser: vi.fn(),
  adminRemoveFeaturedVideo: (...args: unknown[]) => adminRemoveFeaturedVideo(...args),
}));
const fetchAvatar = vi.fn();
vi.mock("@/lib/api/profiles", () => ({ fetchAvatar: (...args: unknown[]) => fetchAvatar(...args) }));

beforeEach(() => {
  fakeUrl.set("");
  for (const fn of [adminListReports, adminGetMemberProfile, adminRemoveProfileContent, adminListOrganisers, adminRemoveFeaturedVideo, fetchAvatar]) {
    fn.mockReset();
  }
  fetchAvatar.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:copy"), revokeObjectURL: vi.fn() });
});
afterEach(cleanup);

function admin(children: React.ReactNode) {
  return render(<FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>{children}</FakeAuthProvider>);
}

const PROFILE_REPORT: AdminReport = {
  reportId: "r1",
  status: "open",
  reason: "inappropriate",
  createdAt: "2026-10-20T09:00:00.000Z",
  reportedDisplayName: "Aisha L.",
  reportedAccountExists: true,
  reportedSuspended: false,
  context: [],
  targetType: "profile",
  reportedProfileId: "p1",
  reportedBio: "<b>not html</b>",
  reportedInstagramHandle: "aisha.paints",
  reportedAvatarUrl: "/api/admin/reports/r1/avatar",
};

describe("admin: profile reports", () => {
  it("says what was reported and shows the copies (photo fetched with the admin's token, text as text)", async () => {
    adminListReports.mockResolvedValue({ items: [PROFILE_REPORT] });
    admin(<ReportQueue />);
    const heading = await screen.findByRole("heading", { name: "Sexual or offensive content: Aisha L." });
    const article = heading.closest("article") as HTMLElement;
    expect(within(article).getByText("Member profile")).toBeInTheDocument();
    expect(within(article).getByText("<b>not html</b>")).toBeInTheDocument();
    expect(within(article).getByText("@aisha.paints")).toBeInTheDocument();
    expect(await within(article).findByRole("img", { name: "Reported profile photo" })).toHaveAttribute("src", "blob:copy");
    expect(fetchAvatar).toHaveBeenCalledWith("/api/admin/reports/r1/avatar", expect.any(Function), expect.any(AbortSignal));
  });

  it("removes the chosen content with a reason (required), and says what was removed", async () => {
    adminListReports.mockResolvedValue({ items: [PROFILE_REPORT] });
    adminRemoveProfileContent.mockResolvedValue({
      profileId: "p1",
      displayName: "Aisha L.",
      profileVisible: true,
      hasAvatar: false,
      suspended: false,
      moderationLog: [],
      removed: ["avatar", "bio"],
    });
    admin(<ReportQueue />);
    const heading = await screen.findByRole("heading", { name: /Aisha L\./ });
    const article = heading.closest("article") as HTMLElement;
    const group = within(article).getByRole("group", { name: "Remove from their profile" });

    // Nothing chosen: said on the group, focus to the first box.
    fireEvent.click(within(article).getByRole("button", { name: "Remove" }));
    expect(within(group).getByText("Choose what to remove.")).toBeInTheDocument();
    await waitFor(() => expect(within(group).getByRole("checkbox", { name: "Photo" })).toHaveFocus());

    fireEvent.click(within(group).getByRole("checkbox", { name: "Bio" }));
    fireEvent.click(within(group).getByRole("checkbox", { name: "Photo" }));
    // No reason: refused, on the reason field.
    fireEvent.click(within(article).getByRole("button", { name: "Remove" }));
    const reason = within(article).getByLabelText("Reason (admins only, logged)");
    await waitFor(() => expect(reason).toHaveFocus());
    expect(adminRemoveProfileContent).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "Explicit photo and bio." } });
    fireEvent.click(within(article).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(adminRemoveProfileContent).toHaveBeenCalledWith(
        "p1",
        { fields: ["avatar", "bio"], reason: "Explicit photo and bio." },
        expect.any(Function),
      ),
    );
    expect(await within(article).findByText("Removed: Photo and bio. Logged with your reason.")).toBeInTheDocument();
  });

  it("opens the member's current profile and moderation log on request", async () => {
    adminListReports.mockResolvedValue({ items: [PROFILE_REPORT] });
    adminGetMemberProfile.mockResolvedValue({
      profileId: "p1",
      displayName: "Aisha L.",
      profileVisible: false,
      hasAvatar: false,
      suspended: false,
      bio: "Now tame.",
      moderationLog: [{ removed: ["instagram"], reason: "Spam link.", at: "2026-10-19T00:00:00.000Z" }],
    });
    admin(<ReportQueue />);
    const summary = await screen.findByText("Their profile now");
    expect(adminGetMemberProfile).not.toHaveBeenCalled();
    const details = summary.closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Now tame.")).toBeInTheDocument();
    expect(screen.getByText(/removed instagram/)).toBeInTheDocument();
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
  });

  it("a message report has no profile tools", async () => {
    adminListReports.mockResolvedValue({ items: [{ ...PROFILE_REPORT, targetType: "conversation", reportedAvatarUrl: undefined }] });
    admin(<ReportQueue />);
    await screen.findByText("Messages");
    expect(screen.queryByRole("group", { name: "Remove from their profile" })).toBeNull();
  });
});

function organiser(overrides: Partial<AdminOrganiserRecord> = {}): AdminOrganiserRecord {
  return {
    ownerUserId: "u1",
    organiserId: "o1",
    displayName: "Northside Noise",
    contactEmail: "o1@example.com",
    description: "Loud nights.",
    categories: ["live-music"],
    status: "approved",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    recentEdits: [],
    featuredVideo: { provider: "youtube", id: "dQw4w9WgXcQ" },
    ...overrides,
  };
}

describe("admin: organiser featured video", () => {
  it("shows the video as a link and removes it with a reason (required), then says so", async () => {
    const before = organiser();
    const after = organiser({
      featuredVideo: undefined,
      recentEdits: [
        {
          kind: "profile_edit",
          at: "2026-10-21T00:00:00.000Z",
          byStaff: true,
          reason: "Not their video.",
          changes: { featuredVideo: { old: "youtube:dQw4w9WgXcQ", new: null } },
        },
      ],
    });
    adminListOrganisers.mockImplementation(async ({ status }: AdminListOrganisersQuery) => ({
      items: status === "pending" ? [] : [before],
    }));
    adminRemoveFeaturedVideo.mockResolvedValue(after);
    admin(<OrganiserQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "Approved" }));
    const link = await screen.findByRole("link", { name: "YouTube: https://www.youtube.com/watch?v=dQw4w9WgXcQ (opens in a new tab)" });
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByRole("button", { name: "Remove video…" }));
    const reason = screen.getByLabelText("Reason (kept on their log)");
    await waitFor(() => expect(reason).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Remove video" }));
    expect(adminRemoveFeaturedVideo).not.toHaveBeenCalled();
    expect(reason).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(reason, { target: { value: "Not their video." } });
    fireEvent.click(screen.getByRole("button", { name: "Remove video" }));
    await waitFor(() => expect(adminRemoveFeaturedVideo).toHaveBeenCalledWith("o1", "Not their video.", expect.any(Function)));
    expect(await screen.findByText("Removed Northside Noise’s featured video.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Northside Noise" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Remove video…" })).toBeNull();

    // The log names the field and the Sheltüh team, with the reason.
    const log = screen.getByText(/Recent changes/).closest("details") as HTMLElement;
    expect(within(log).getByText("Edit by the Sheltüh team")).toBeInTheDocument();
    expect(within(log).getByText("Featured video")).toBeInTheDocument();
    expect(within(log).getByText("YouTube: https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeInTheDocument();
    expect(within(log).getByText("Not their video.")).toBeInTheDocument();
  });
});
