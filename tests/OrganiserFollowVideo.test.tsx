// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FollowingList from "@/components/following/FollowingList";
import FollowButton from "@/components/organisers/FollowButton";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import VideoFacade from "@/components/organisers/VideoFacade";
import { ApiError } from "@/lib/api/client";
import type { PublicOrganiserProfile } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getFollowStatus = vi.fn();
const followOrganiser = vi.fn();
const unfollowOrganiser = vi.fn();
const listFollowing = vi.fn();
vi.mock("@/lib/api/follows", () => ({
  getFollowStatus: (...args: unknown[]) => getFollowStatus(...args),
  followOrganiser: (...args: unknown[]) => followOrganiser(...args),
  unfollowOrganiser: (...args: unknown[]) => unfollowOrganiser(...args),
  listFollowing: (...args: unknown[]) => listFollowing(...args),
}));

beforeEach(() => {
  for (const fn of [getFollowStatus, followOrganiser, unfollowOrganiser, listFollowing]) fn.mockReset();
});
afterEach(cleanup);

const ORG = "8c4f6f8e-0d5b-4a51-9a3e-2f6f0b0d1a11";

function withAuth(children: React.ReactNode, auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(<FakeAuthProvider value={auth}>{children}</FakeAuthProvider>);
}

describe("VideoFacade (click to load)", () => {
  it("loads no player until Play is pressed; then the privacy-enhanced iframe, titled and focused", async () => {
    const { container } = render(<VideoFacade video={{ provider: "youtube", id: "dQw4w9WgXcQ" }} title="Northside’s featured video" />);
    expect(container.querySelector("iframe")).toBeNull();
    // Only YouTube's cookie-free still, without a referrer.
    const still = container.querySelector("img");
    expect(still).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(still).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(still).toHaveAttribute("alt", "");
    const play = screen.getByRole("button", { name: "Play video: Northside’s featured video" });
    fireEvent.click(play);
    const frame = container.querySelector("iframe");
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(frame).toHaveAttribute("title", "Northside’s featured video (YouTube video)");
    await waitFor(() => expect(frame).toHaveFocus());
  });

  it("works from the keyboard (a real button) and offers a plain link to the video's page", () => {
    render(<VideoFacade video={{ provider: "vimeo", id: "76979871" }} title="Clip" />);
    const play = screen.getByRole("button", { name: "Play video: Clip" });
    expect(play.tagName).toBe("BUTTON");
    const link = screen.getByRole("link", { name: "Watch on Vimeo (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://vimeo.com/76979871");
  });

  it("Vimeo has no still (nothing requested from Vimeo before the press), and plays with dnt=1", () => {
    const { container } = render(<VideoFacade video={{ provider: "vimeo", id: "76979871" }} title="Clip" />);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Play video/ }));
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://player.vimeo.com/video/76979871?dnt=1&autoplay=1");
  });
});

describe("FollowButton", () => {
  it("signed out: a link to sign in, back to the organiser", () => {
    withAuth(<FollowButton organiserId={ORG} organiserName="Northside Noise" />, fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("link", { name: "Sign in to follow" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(`/organisers/${ORG}`)}`,
    );
    expect(getFollowStatus).not.toHaveBeenCalled();
  });

  it("follows with the email choice (unticked until chosen: consent), as a pressed toggle, and announces it", async () => {
    getFollowStatus.mockResolvedValue({ following: false, notifyNewEvents: false });
    followOrganiser.mockResolvedValue({ following: true, notifyNewEvents: true });
    withAuth(<FollowButton organiserId={ORG} organiserName="Northside Noise" />);
    const button = await screen.findByRole("button", { name: "Follow Northside Noise" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    const email = screen.getByRole("checkbox", { name: "Email me when they announce a new event" });
    expect(email).not.toBeChecked();
    await waitFor(() => expect(email).toBeEnabled());
    fireEvent.click(email);
    expect(followOrganiser).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(followOrganiser).toHaveBeenCalledWith(ORG, { notifyNewEvents: true }, expect.any(Function)));
    // One name for the toggle ("Follow"), its state in aria-pressed.
    await screen.findByRole("button", { name: "Follow Northside Noise", pressed: true });
    expect(screen.queryByRole("button", { name: /^Following/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("We’ll email you when they announce a new event.");
  });

  it("left unticked, follows without emails, saying so explicitly (notifyNewEvents: false)", async () => {
    getFollowStatus.mockResolvedValue({ following: false, notifyNewEvents: false });
    followOrganiser.mockResolvedValue({ following: true, notifyNewEvents: false });
    withAuth(<FollowButton organiserId={ORG} organiserName="N" />);
    const email = await screen.findByRole("checkbox", { name: "Email me when they announce a new event" });
    expect(email).not.toBeChecked();
    fireEvent.click(await screen.findByRole("button", { name: "Follow N" }));
    await waitFor(() => expect(followOrganiser).toHaveBeenCalledWith(ORG, { notifyNewEvents: false }, expect.any(Function)));
  });

  it("if the follow status can't be loaded, it still starts unticked and sends an explicit false (Spam Act consent)", async () => {
    getFollowStatus.mockRejectedValue(new ApiError(500, "Server error."));
    followOrganiser.mockResolvedValue({ following: true, notifyNewEvents: false });
    withAuth(<FollowButton organiserId={ORG} organiserName="N" />);
    const email = await screen.findByRole("checkbox", { name: "Email me when they announce a new event" });
    await waitFor(() => expect(email).toBeEnabled());
    expect(email).not.toBeChecked();
    fireEvent.click(await screen.findByRole("button", { name: "Follow N" }));
    await waitFor(() => expect(followOrganiser).toHaveBeenCalledWith(ORG, { notifyNewEvents: false }, expect.any(Function)));
  });

  it("while following, the checkbox changes the email choice, and the pressed Follow unfollows", async () => {
    getFollowStatus.mockResolvedValue({ following: true, notifyNewEvents: true });
    followOrganiser.mockResolvedValue({ following: true, notifyNewEvents: false });
    unfollowOrganiser.mockResolvedValue(undefined);
    withAuth(<FollowButton organiserId={ORG} organiserName="N" />);
    const email = await screen.findByRole("checkbox", { name: "Email me when they announce a new event" });
    await waitFor(() => expect(email).toBeEnabled());
    fireEvent.click(email);
    await waitFor(() => expect(followOrganiser).toHaveBeenCalledWith(ORG, { notifyNewEvents: false }, expect.any(Function)));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("New-event emails off."));
    fireEvent.click(screen.getByRole("button", { name: "Follow N", pressed: true }));
    await waitFor(() => expect(unfollowOrganiser).toHaveBeenCalledWith(ORG, expect.any(Function)));
    expect(await screen.findByRole("button", { name: "Follow N" })).toHaveAttribute("aria-pressed", "false");
  });

  it("an unverified member is told why (403), as an alert", async () => {
    getFollowStatus.mockResolvedValue({ following: false, notifyNewEvents: false });
    followOrganiser.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    withAuth(<FollowButton organiserId={ORG} organiserName="N" />);
    fireEvent.click(await screen.findByRole("button", { name: "Follow N" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email address first.");
  });

  it("isn't offered for an organiser you can't follow (404)", async () => {
    getFollowStatus.mockRejectedValue(new ApiError(404, "Not found."));
    const { container } = withAuth(<FollowButton organiserId={ORG} organiserName="N" />);
    await waitFor(() => expect(getFollowStatus).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

const PROFILE: PublicOrganiserProfile = {
  organiserId: ORG,
  displayName: "Northside Noise",
  description: "Loud nights.",
  categories: ["live-music"],
  socialLinks: {},
  memberSince: "2026-03",
  featuredVideo: { provider: "youtube", id: "dQw4w9WgXcQ" },
  followerCount: 1234,
  eventsHosted: 7,
  upcomingEvents: [],
  recentEvents: [],
};

describe("organiser page: follow, numbers, video", () => {
  it("shows the follower count (when sent), events hosted, Follow, and the video facade", async () => {
    getFollowStatus.mockResolvedValue({ following: false, notifyNewEvents: false });
    const { container } = withAuth(<OrganiserProfileView profile={PROFILE} />);
    const followers = screen.getByText("Followers");
    expect(followers.nextElementSibling).toHaveTextContent("1,234");
    expect(screen.getByText("Events hosted").nextElementSibling).toHaveTextContent("7");
    expect(await screen.findByRole("button", { name: "Follow Northside Noise" })).toBeInTheDocument();
    const video = screen.getByRole("region", { name: "Featured video" });
    expect(within(video).getByRole("button", { name: /Play video/ })).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("hides the follower count below 10 (null) and has no video section without one", () => {
    withAuth(<OrganiserProfileView profile={{ ...PROFILE, followerCount: null, featuredVideo: null }} />, fakeAuthValue({ status: "signed-out" }));
    expect(screen.queryByText("Followers")).toBeNull();
    expect(screen.getByText("Events hosted")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Featured video" })).toBeNull();
  });
});

describe("/following", () => {
  const items = [
    { organiserId: "o1", displayName: "Northside Noise", notifyNewEvents: true, followedAt: "2026-10-01T00:00:00.000Z" },
    { organiserId: "o2", displayName: "Paper Moon", notifyNewEvents: false, followedAt: "2026-09-01T00:00:00.000Z" },
  ];

  it("lists followed organisers with their email choice; Unfollow removes one and focuses the next", async () => {
    listFollowing.mockResolvedValue({ items });
    unfollowOrganiser.mockResolvedValue(undefined);
    followOrganiser.mockResolvedValue({ following: true, notifyNewEvents: true });
    withAuth(<FollowingList />);
    expect(await screen.findByRole("link", { name: "Northside Noise" })).toHaveAttribute("href", "/organisers/o1");
    const boxes = screen.getAllByRole("checkbox", { name: "Email me when they announce a new event" });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
    fireEvent.click(boxes[1]);
    await waitFor(() => expect(followOrganiser).toHaveBeenCalledWith("o2", { notifyNewEvents: true }, expect.any(Function)));
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Northside Noise" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Northside Noise" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Paper Moon" })).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("You’ve unfollowed Northside Noise.");
  });

  it("empty, and signed out", async () => {
    listFollowing.mockResolvedValue({ items: [] });
    const first = withAuth(<FollowingList />);
    expect(await screen.findByText("You’re not following anyone yet")).toBeInTheDocument();
    first.unmount();
    withAuth(<FollowingList />, fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Ffollowing");
  });

  it("a load failure is shown, with Try again", async () => {
    listFollowing.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server."));
    listFollowing.mockResolvedValueOnce({ items });
    withAuth(<FollowingList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Paper Moon" })).toBeInTheDocument();
  });
});
