// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveMemberProfile from "@/components/members/LiveMemberProfile";
import { ApiError } from "@/lib/api/client";
import type { PublicEvent } from "@/lib/api/public-events";
import type { MemberProfile, ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
const getMemberProfile = vi.fn();
const fetchAvatar = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfile(...args),
  getMemberProfile: (...args: unknown[]) => getMemberProfile(...args),
  fetchAvatar: (...args: unknown[]) => fetchAvatar(...args),
}));
const blockMember = vi.fn();
const reportMember = vi.fn();
const startConversation = vi.fn();
vi.mock("@/lib/api/messages", () => ({
  blockMember: (...args: unknown[]) => blockMember(...args),
  reportMember: (...args: unknown[]) => reportMember(...args),
  startConversation: (...args: unknown[]) => startConversation(...args),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/members/p1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const createObjectURL = vi.fn(() => "blob:photo-1");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  for (const fn of [getMyProfile, getMemberProfile, fetchAvatar, blockMember, reportMember, startConversation]) fn.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

const OWN: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  profileId: "me",
  profileVisible: true,
};

const EVENT: PublicEvent = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "neon-static",
  title: "Neon Static",
  description: "d",
  category: "live-music",
  venueName: "Warehouse 9",
  venueAddress: "9 Rupert St",
  suburb: "Collingwood",
  startsAt: "2099-03-06T09:00:00.000Z",
  endsAt: "2099-03-06T12:00:00.000Z",
  organiserName: "Static Collective",
  ticketTypes: [{ id: "t", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
};

const MEMBER: MemberProfile = {
  profileId: "p1",
  displayName: "Aisha L.",
  bio: "Painter. https://example.com\nLoves noise.",
  instagramHandle: "aisha.paints",
  instagramUrl: "https://www.instagram.com/aisha.paints/",
  hasAvatar: true,
  avatarUrl: "/api/profiles/p1/avatar?v=3",
  avatarThumbUrl: "/api/profiles/p1/avatar?size=thumb&v=3",
  isYou: false,
  upcomingEvents: [EVENT],
  canMessage: true,
};

function renderPage(auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <LiveMemberProfile profileId="p1" />
    </FakeAuthProvider>,
  );
}

describe("/members/[profileId] gate", () => {
  it("signed out: asks to sign in, coming back here", () => {
    renderPage(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to see member profiles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fmembers%2Fp1");
    expect(getMemberProfile).not.toHaveBeenCalled();
  });

  it("no profile of your own: says to create one, and asks the API nothing about the member", async () => {
    getMyProfile.mockRejectedValue(new ApiError(404, "No profile."));
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Create a profile to see member profiles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create your profile" })).toHaveAttribute("href", "/account");
    expect(getMemberProfile).not.toHaveBeenCalled();
  });

  it("a 404 is 'This profile isn't available', never why", async () => {
    getMyProfile.mockResolvedValue(OWN);
    getMemberProfile.mockRejectedValue(new ApiError(404, "Not found."));
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "This profile isn’t available" })).toBeInTheDocument();
  });

  it("an unverified email (403) says to verify", async () => {
    getMyProfile.mockResolvedValue(OWN);
    getMemberProfile.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Verify your email to see member profiles" })).toBeInTheDocument();
  });

  it("rate-limited: says so, and Try again loads again and focuses the heading", async () => {
    getMyProfile.mockResolvedValue(OWN);
    getMemberProfile.mockRejectedValueOnce(new ApiError(429, "Too many."));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("looked at a lot of profiles");
    getMemberProfile.mockResolvedValueOnce({ ...MEMBER, hasAvatar: false });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Aisha L." });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("Try again still focuses the new heading when pressed before the error view's effects have run", async () => {
    getMyProfile.mockResolvedValue(OWN);
    getMemberProfile.mockRejectedValueOnce(new ApiError(429, "Too many.")).mockResolvedValueOnce({ ...MEMBER, hasAvatar: false });
    const { container } = renderPage();
    // Resume as soon as the error view is in the DOM: a microtask after React's
    // commit, before its passive effects (a later scheduler task) have run.
    // Busy machines hit this between findByRole and the click.
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    scope.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!container.querySelector('[role="alert"]')) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(container, { childList: true, subtree: true });
      });
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = true;
    }
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Aisha L." });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe("/members/[profileId] profile", () => {
  beforeEach(() => {
    getMyProfile.mockResolvedValue(OWN);
    getMemberProfile.mockResolvedValue(MEMBER);
    fetchAvatar.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  });

  it("shows the name, photo (a blob URL, revoked on unmount), bio as text, Instagram in a new tab, and their events", async () => {
    const { unmount, container } = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Aisha L." })).toBeInTheDocument();
    expect(getMemberProfile).toHaveBeenCalledWith("p1", expect.any(Function));
    await waitFor(() => expect(container.querySelector("img[data-member-photo]")).toHaveAttribute("src", "blob:photo-1"));
    expect(fetchAvatar).toHaveBeenCalledWith("/api/profiles/p1/avatar?v=3", expect.any(Function), expect.any(AbortSignal));
    // The bio's link stays text.
    expect(screen.getByText(/Painter\. https:\/\/example\.com/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/ })).toBeNull();
    const instagram = screen.getByRole("link", { name: "@aisha.paints on Instagram (opens in a new tab)" });
    expect(instagram).toHaveAttribute("href", "https://www.instagram.com/aisha.paints/");
    expect(instagram).toHaveAttribute("target", "_blank");
    expect(instagram.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("heading", { name: "Events Aisha L. is going to" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Neon Static/ })).toHaveAttribute("href", "/events/neon-static");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
  });

  it("no photo: initials, and no photo request", async () => {
    getMemberProfile.mockResolvedValue({ ...MEMBER, hasAvatar: false, avatarUrl: undefined });
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Aisha L." });
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(fetchAvatar).not.toHaveBeenCalled();
  });

  it("your own profile: 'This is how members see you' with an edit link, and no actions", async () => {
    getMemberProfile.mockResolvedValue({ ...MEMBER, isYou: true, canMessage: false });
    renderPage();
    expect(await screen.findByText(/This is how members see you/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit your profile" })).toHaveAttribute("href", "/account#member-profile");
    expect(screen.queryByRole("button", { name: "Block" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
  });

  it("Message opens a first-message form by profile, then links to the conversation (focused)", async () => {
    startConversation.mockResolvedValue({ conversationId: "c9" });
    renderPage();
    const message = await screen.findByRole("button", { name: "Message" });
    fireEvent.click(message);
    expect(message).toHaveAttribute("aria-expanded", "true");
    const box = screen.getByLabelText("Your message");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByText(/the event you’re both going to/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "Hi! See you there." } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(startConversation).toHaveBeenCalledWith({ profileId: "p1", body: "Hi! See you there." }, expect.any(Function));
    const sent = await screen.findByText(/Request sent to Aisha L\./);
    await waitFor(() => expect(sent).toHaveFocus());
    expect(screen.getAllByRole("link", { name: "View conversation" })[0]).toHaveAttribute("href", "/messages/c9");
  });

  it("an existing conversation is a link to it; can't message says when they can", async () => {
    getMemberProfile.mockResolvedValueOnce({ ...MEMBER, canMessage: false, conversationId: "c1" });
    const first = renderPage();
    expect(await screen.findByRole("link", { name: "Open your conversation" })).toHaveAttribute("href", "/messages/c1");
    first.unmount();
    getMemberProfile.mockResolvedValueOnce({ ...MEMBER, canMessage: false });
    renderPage();
    expect(await screen.findByText(/You can message Aisha L\. when you’re both on the same event/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
  });

  it("Block asks first (focus on Cancel), then blocks by profile and says so (focused)", async () => {
    blockMember.mockResolvedValue({ blockId: "b1", createdAt: "x" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Block" }));
    const group = screen.getByRole("group", { name: "Block Aisha L.?" });
    await waitFor(() => expect(within(group).getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Block" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, block" }));
    expect(blockMember).toHaveBeenCalledWith({ profileId: "p1" }, expect.any(Function));
    const heading = await screen.findByRole("heading", { level: 1, name: "You blocked Aisha L." });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("link", { name: "Blocked members" })).toHaveAttribute("href", "/messages/blocked");
  });

  it("Report uses the report dialog with the profile's wording, sent by profile", async () => {
    reportMember.mockResolvedValue({ reportId: "r1", createdAt: "x" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Report" }));
    const dialog = screen.getByRole("dialog", { name: "Report Aisha L." });
    expect(within(dialog).getByText(/copy of Aisha L\.’s profile \(name, bio, Instagram and photo\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Spam or a scam" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(reportMember).toHaveBeenCalledWith({ profileId: "p1", reason: "spam", details: undefined }, expect.any(Function)),
    );
    const thanks = await screen.findByText(/Your report has been sent/);
    await waitFor(() => expect(thanks.closest("[tabindex='-1']")).toHaveFocus());
  });
});
