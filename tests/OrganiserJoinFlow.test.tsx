// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserJoinFlow, { JOINED_PATH } from "@/components/organisers/OrganiserJoinFlow";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { ORGANISER_LINK_UNAVAILABLE } from "@/lib/invites";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const viewOrganiserLink = vi.fn();
const joinWithOrganiserLink = vi.fn();
vi.mock("@/lib/api/organiser-links", () => ({
  viewOrganiserLink: (...args: unknown[]) => viewOrganiserLink(...args),
  joinWithOrganiserLink: (...args: unknown[]) => joinWithOrganiserLink(...args),
}));

const getMyOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  getMyOrganiser: (...args: unknown[]) => getMyOrganiser(...args),
}));

const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }) }));

const TOKEN = "Q".repeat(40) + "b_-";
const EXPIRES = "2026-11-03T01:00:00.000Z";
const STORAGE_KEY = "sheltuh:organiser-link";
const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", email: undefined, userId: undefined, accessToken: undefined };
const SIGNED_IN: Partial<AuthContextValue> = { status: "signed-in", email: "mia@example.com", userId: "u-mia" };

function organiser(status: OrganiserRecord["status"], displayName = "Static Collective"): OrganiserRecord {
  return {
    organiserId: "org-1",
    ownerUserId: "u-mia",
    displayName,
    contactEmail: "mia@example.com",
    description: "",
    categories: ["live-music"],
    status,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as OrganiserRecord;
}

/** Renders the page under an auth value the test can change; signOut signs out, as the real one does. */
function renderFlow(initial: Partial<AuthContextValue> = SIGNED_OUT, { at = `/organisers/join#token=${TOKEN}` } = {}) {
  window.history.replaceState(null, "", at);
  const signOut = vi.fn();
  const getAccessToken = vi.fn<AuthContextValue["getAccessToken"]>().mockResolvedValue("fake-access-token");
  const controls: { set?: (overrides: Partial<AuthContextValue>) => void } = {};
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<AuthContextValue>>(initial);
    controls.set = (next) => setOverrides((prev) => ({ ...prev, ...next }));
    const value = fakeAuthValue({
      ...overrides,
      getAccessToken,
      signOut: (scope) => {
        signOut(scope);
        setOverrides((prev) => ({ ...prev, ...SIGNED_OUT }));
      },
    });
    return (
      <FakeAuthProvider value={value}>
        <OrganiserJoinFlow />
      </FakeAuthProvider>
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  return { signOut, controls };
}

beforeEach(() => {
  api.configured = true;
  sessionStorage.clear();
  for (const fn of [viewOrganiserLink, joinWithOrganiserLink, getMyOrganiser, push]) fn.mockReset();
  viewOrganiserLink.mockResolvedValue({ expiresAt: EXPIRES });
  getMyOrganiser.mockRejectedValue(new ApiError(404, "No organiser application found."));
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const INVITED = "You’ve been invited to sell tickets on Sheltüh";

describe("/organisers/join before signing in", () => {
  it("in the demo, says links work on the live site and calls nothing", async () => {
    api.configured = false;
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Organiser links work on the live site" })).toBeInTheDocument();
    expect(viewOrganiserLink).not.toHaveBeenCalled();
  });

  it("checks the link once, takes the token out of the address bar, keeps it for this tab, and offers sign up / sign in back here", async () => {
    renderFlow();
    const heading = await screen.findByRole("heading", { level: 1, name: INVITED });
    expect(heading).toHaveAccessibleDescription(/approved straight away\. This link works once, until/);
    expect(viewOrganiserLink).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/organisers/join");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);
    // The return path carries no token.
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup?next=%2Forganisers%2Fjoin");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Forganisers%2Fjoin");
    expect(joinWithOrganiserLink).not.toHaveBeenCalled();
  });

  it("back from signing in without the fragment, uses the token this tab kept", async () => {
    sessionStorage.setItem(STORAGE_KEY, TOKEN);
    renderFlow(SIGNED_IN, { at: "/organisers/join" });
    expect(await screen.findByLabelText("Organiser name")).toBeInTheDocument();
    expect(viewOrganiserLink).toHaveBeenCalledWith(TOKEN);
  });

  it("without a token anywhere, says the link is incomplete, focused, and checks nothing", async () => {
    renderFlow(SIGNED_OUT, { at: "/organisers/join" });
    const heading = await screen.findByRole("heading", { level: 1, name: "This link is incomplete" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(viewOrganiserLink).not.toHaveBeenCalled();
  });

  it("an unusable link (unknown, used, expired or cancelled) says so in one way, focused, and is forgotten", async () => {
    viewOrganiserLink.mockRejectedValue(new ApiError(404, ORGANISER_LINK_UNAVAILABLE, undefined, { code: "unavailable" }));
    renderFlow();
    const heading = await screen.findByRole("heading", { level: 1, name: "This link can’t be used" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(ORGANISER_LINK_UNAVAILABLE);
    expect(screen.getByRole("link", { name: /^Email / })).toHaveAttribute(
      "href",
      expect.stringContaining("subject=New%20organiser%20link"),
    );
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("a check that fails for another reason offers Try again", async () => {
    viewOrganiserLink.mockRejectedValueOnce(new ApiError(429, "Too many.")).mockResolvedValueOnce({ expiresAt: EXPIRES });
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "We couldn’t check this link" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: INVITED })).toBeInTheDocument();
  });
});

describe("/organisers/join signed in", () => {
  it("asks only for the name and categories, then joins and goes to the dashboard, forgetting the token", async () => {
    joinWithOrganiserLink.mockResolvedValue({ organiserId: "org-new", displayName: "Neon Collective" });
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    expect(within(form).getByLabelText("Organiser name")).toHaveAttribute("aria-required", "true");
    expect(within(form).getByText(/mia@example\.com/)).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "  Neon Collective " } });
    fireEvent.click(within(form).getByLabelText("Live music"));
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(JOINED_PATH));
    expect(joinWithOrganiserLink).toHaveBeenCalledWith(
      { token: TOKEN, displayName: "Neon Collective", categories: ["live-music"] },
      expect.any(Function),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "You’re in" })).toBeInTheDocument();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("checks the fields first: each described by its error, focus on the first; nothing sent", async () => {
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    const name = within(form).getByLabelText("Organiser name");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/Enter your organiser name\./);
    expect(within(form).getByText("Choose at least one category.")).toBeInTheDocument();
    expect(joinWithOrganiserLink).not.toHaveBeenCalled();
  });

  it("shows the server's field errors on their fields", async () => {
    joinWithOrganiserLink.mockRejectedValue(new ApiError(400, "Please fix the highlighted fields.", { displayName: "Must be 120 characters or fewer." }));
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "Neon" } });
    fireEvent.click(within(form).getByLabelText("Art"));
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    const name = within(form).getByLabelText("Organiser name");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(/Must be 120 characters or fewer\./);
  });

  it("a link that turns out used while joining says so, and the token is forgotten", async () => {
    joinWithOrganiserLink.mockRejectedValue(new ApiError(404, ORGANISER_LINK_UNAVAILABLE, undefined, { code: "unavailable" }));
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "Neon" } });
    fireEvent.click(within(form).getByLabelText("Art"));
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "This link can’t be used" });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("a pending application: just Join, which approves it as it is", async () => {
    getMyOrganiser.mockResolvedValue(organiser("pending"));
    joinWithOrganiserLink.mockResolvedValue({ organiserId: "org-1", displayName: "Static Collective" });
    renderFlow(SIGNED_IN);
    const heading = await screen.findByRole("heading", { level: 1, name: INVITED });
    expect(heading).toHaveAccessibleDescription(/Your application for Static Collective is waiting for review\. Joining with this link approves it now\./);
    const form = screen.getByRole("form", { name: "Join as an organiser" });
    expect(within(form).queryByLabelText("Organiser name")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(JOINED_PATH));
    expect(joinWithOrganiserLink).toHaveBeenCalledWith({ token: TOKEN }, expect.any(Function));
  });

  it("already an organiser: says the link wasn't used, offers the dashboard or signing out; nothing sent", async () => {
    getMyOrganiser.mockResolvedValue(organiser("approved"));
    const { signOut } = renderFlow(SIGNED_IN);
    const heading = await screen.findByRole("heading", { level: 1, name: "You’re already an organiser" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(/already runs Static Collective, so this link wasn’t used/);
    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith("local");
    expect(await screen.findByRole("link", { name: "Create account" })).toBeInTheDocument();
    expect(joinWithOrganiserLink).not.toHaveBeenCalled();
  });

  it("a rejected or taken-down organiser can't use it; nothing sent", async () => {
    getMyOrganiser.mockResolvedValue(organiser("rejected"));
    renderFlow(SIGNED_IN);
    const heading = await screen.findByRole("heading", { level: 1, name: "This account can’t join with this link" });
    expect(heading).toHaveAccessibleDescription(/isn’t active, so this link wasn’t used/);
    expect(joinWithOrganiserLink).not.toHaveBeenCalled();
  });

  it("a 409 from the server (approved meanwhile) reads the account's organiser again", async () => {
    joinWithOrganiserLink.mockRejectedValue(new ApiError(409, "Already.", undefined, { code: "already_organiser" }));
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "Neon" } });
    fireEvent.click(within(form).getByLabelText("Art"));
    getMyOrganiser.mockResolvedValue(organiser("approved", "Neon"));
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You’re already an organiser" })).toBeInTheDocument();
  });

  it("any other failure is said where focus goes, keeping what was typed", async () => {
    joinWithOrganiserLink.mockRejectedValue(new ApiError(429, "That's been tried a lot. Wait a while, then try again."));
    renderFlow(SIGNED_IN);
    const form = await screen.findByRole("form", { name: "Join as an organiser" });
    fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "Neon" } });
    fireEvent.click(within(form).getByLabelText("Art"));
    fireEvent.click(within(form).getByRole("button", { name: "Join as an organiser" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("That's been tried a lot.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(form).getByLabelText("Organiser name")).toHaveValue("Neon");
    expect(push).not.toHaveBeenCalled();
  });
});
