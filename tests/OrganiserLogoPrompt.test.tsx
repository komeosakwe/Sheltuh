// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import type { OrganiserRecord, PublicOrganiserProfile } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const ORG = "org-1";

let apiConfigured = true;
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return apiConfigured;
  },
}));
vi.mock("@/lib/api/follows", () => ({
  getFollowStatus: vi.fn().mockResolvedValue({ following: false, notifyNewEvents: false }),
  followOrganiser: vi.fn(),
  unfollowOrganiser: vi.fn(),
}));
let mine: Pick<OrganiserRecord, "organiserId" | "status" | "logoUrl"> | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: mine, error: null, refetch: vi.fn() }),
}));

beforeEach(() => {
  apiConfigured = true;
  mine = { organiserId: ORG, status: "approved" };
});
afterEach(cleanup);

function profile(overrides: Partial<PublicOrganiserProfile> = {}): PublicOrganiserProfile {
  return {
    organiserId: ORG,
    displayName: "Northside Noise",
    description: "Loud nights.",
    categories: [],
    socialLinks: {},
    memberSince: "2026-03",
    upcomingEvents: [],
    recentEvents: [],
    ...overrides,
  };
}

function view(p: PublicOrganiserProfile, auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <OrganiserProfileView profile={p} upcoming={[]} past={[]} />
    </FakeAuthProvider>,
  );
}

describe("organiser profile: Add logo for its own organiser", () => {
  it("links to the Profile page's logo field when the viewer is this organiser and there's no logo", () => {
    view(profile());
    expect(screen.getByRole("link", { name: "Add logo" })).toHaveAttribute("href", "/dashboard/profile#logo");
  });

  it("is hidden once they have a logo", () => {
    mine = { organiserId: ORG, status: "approved", logoUrl: "/api/organisers/org-1/logo?v=1" };
    view(profile({ logoUrl: "/api/organisers/org-1/logo?v=1" }));
    expect(screen.queryByRole("link", { name: "Add logo" })).toBeNull();
  });

  it("is hidden for anyone else, signed out, and in the demo", () => {
    mine = { organiserId: "someone-else", status: "approved" };
    view(profile());
    expect(screen.queryByRole("link", { name: "Add logo" })).toBeNull();
    cleanup();
    mine = { organiserId: ORG, status: "approved" };
    view(profile(), fakeAuthValue({ status: "signed-out" }));
    expect(screen.queryByRole("link", { name: "Add logo" })).toBeNull();
    cleanup();
    apiConfigured = false;
    view(profile());
    expect(screen.queryByRole("link", { name: "Add logo" })).toBeNull();
  });
});

describe("organiser profile: events hosted", () => {
  it("is shown from one event hosted", () => {
    view(profile({ eventsHosted: 3 }));
    expect(screen.getByText("Events hosted")).toBeInTheDocument();
  });

  it("is hidden at 0 (and when not sent)", () => {
    view(profile({ eventsHosted: 0 }));
    expect(screen.queryByText("Events hosted")).toBeNull();
    cleanup();
    view(profile());
    expect(screen.queryByText("Events hosted")).toBeNull();
  });
});
