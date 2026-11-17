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

describe("organiser profile: Add logo over a cover", () => {
  it("takes the logo's place over the cover's corner, filled and ringed so the photo doesn't show through", () => {
    view(profile({ coverUrl: "/api/organisers/org-1/cover?v=1" }));
    const link = screen.getByRole("link", { name: "Add logo" });
    expect(link).toHaveClass("bg-background", "ring-4", "ring-background", "xl:size-40");
    expect(link.parentElement).toHaveClass("-mt-12");
  });

  it("isn't filled or ringed without a cover", () => {
    view(profile());
    expect(screen.getByRole("link", { name: "Add logo" })).not.toHaveClass("ring-4");
  });
});

describe("organiser profile: the links column follows what the logo slot holds", () => {
  const COVER = "/api/organisers/org-1/cover?v=1";
  const KEYED = "lg:group-has-[[data-organiser-logo-slot]:not(:empty)]/intro:pt-22";
  const links = () => screen.getByRole("region", { name: "Links" });
  const slot = (container: HTMLElement) => container.querySelector("[data-organiser-logo-slot]");

  it("with a cover and no logo, the owner's Add logo fills the slot, which the links' padding is keyed on", () => {
    const { container } = view(profile({ coverUrl: COVER, websiteUrl: "https://northside.example" }));
    expect(slot(container)).toContainElement(screen.getByRole("link", { name: "Add logo" }));
    // Level with the strap under the overlapping box (the overlap + 24) whenever the slot holds something,
    // the strap alone (32) otherwise; both from one grid, so the slot and the links are in the same group.
    expect(links()).toHaveClass("lg:pt-8", KEYED, "xl:group-has-[[data-organiser-logo-slot]:not(:empty)]/intro:pt-26");
    const group = links().closest(".group\\/intro");
    expect(group).toContainElement(slot(container) as HTMLElement);
  });

  it("for anyone else the slot is empty (no logo, no prompt), so the strap's 32 applies", () => {
    mine = { organiserId: "someone-else", status: "approved" };
    const { container } = view(profile({ coverUrl: COVER, websiteUrl: "https://northside.example" }));
    expect(slot(container)).toBeEmptyDOMElement();
    expect(links()).toHaveClass("lg:pt-8", KEYED);
  });

  it("without a cover it's 16 either way (the logo, the prompt or the strap starts the header)", () => {
    view(profile({ websiteUrl: "https://northside.example" }));
    expect(links()).toHaveClass("lg:pt-4");
    expect(links().className).not.toContain("pt-22");
  });
});

describe("organiser profile: Follow and Share", () => {
  it("holds Follow's place while the session loads, and lets Share wrap under it at large text", () => {
    const { container } = view(profile(), fakeAuthValue({ status: "loading" }));
    const placeholder = container.querySelector("[data-follow-placeholder]");
    expect(placeholder).toHaveClass("sm:w-44", "grow", "basis-40");
    expect(placeholder?.parentElement).toHaveClass("flex-wrap");
    cleanup();
    view(profile(), fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("link", { name: "Sign in to follow" })).toHaveClass("min-w-0", "grow", "basis-40", "sm:flex-none");
  });
});

describe("organiser profile: event count", () => {
  it("is shown from one event", () => {
    view(profile({ eventCount: 3 }));
    expect(screen.getByText("events").parentElement).toHaveTextContent("3 events");
  });

  it("is hidden at 0 (and when not sent)", () => {
    view(profile({ eventCount: 0 }));
    expect(screen.queryByText(/^events?$/)).toBeNull();
    cleanup();
    view(profile());
    expect(screen.queryByText(/^events?$/)).toBeNull();
  });
});
