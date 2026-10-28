// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

// The real useOrganiser, against a live API (mocked below).
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace, push: vi.fn() }) }));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyOrganiser = vi.fn();
const applyAsOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  getMyOrganiser: (...args: unknown[]) => getMyOrganiser(...args),
  applyAsOrganiser: (...args: unknown[]) => applyAsOrganiser(...args),
  resubmitOrganiser: vi.fn(),
}));

const NOT_FOUND = new ApiError(404, "Not found.");

const PENDING: OrganiserRecord = {
  ownerUserId: "user-a",
  organiserId: "org-1",
  displayName: "Neon Collective",
  contactEmail: "contact@example.com",
  description: "We run events.",
  categories: ["live-music"],
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", userId: undefined, email: undefined, accessToken: undefined };
const accountA = (lastSignInAt = "2026-10-25T09:00:00Z"): Partial<AuthContextValue> => ({
  status: "signed-in",
  userId: "user-a",
  email: "a@example.com",
  accessToken: "a-token",
  lastSignInAt,
});
const accountB: Partial<AuthContextValue> = {
  status: "signed-in",
  userId: "user-b",
  email: "b@example.com",
  accessToken: "b-token",
  lastSignInAt: "2026-10-25T10:30:00Z",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
  getMyOrganiser.mockReset().mockRejectedValue(NOT_FOUND);
  applyAsOrganiser.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** The page under an auth state that can change underneath it, as another tab (or an expiry) would. */
function mount(initial: Partial<AuthContextValue>) {
  const shared = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() };
  const tree = (auth: Partial<AuthContextValue>) => (
    <FakeAuthProvider value={fakeAuthValue({ ...shared, ...auth })}>
      <ApplyPageContent />
    </FakeAuthProvider>
  );
  const view = render(tree(initial));
  const become = (auth: Partial<AuthContextValue>) => act(() => view.rerender(tree(auth)));
  return { ...shared, become };
}

async function fillDraft() {
  fireEvent.change(await screen.findByLabelText("Organiser name"), { target: { value: "Neon Collective" } });
  fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "contact@example.com" } });
  fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "We run events." } });
  fireEvent.click(screen.getByLabelText("Live music"));
}

const submit = () => screen.getByRole("button", { name: "Submit application" });

describe("ApplyPageContent: a draft survives its session running out", () => {
  it("keeps the form (and every typed field) while signed out and while loading again, then finishes after a sign-in in another tab", async () => {
    applyAsOrganiser.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValueOnce(PENDING);
    const { become } = mount(accountA());
    await fillDraft();
    const nameField = screen.getByLabelText("Organiser name");

    // The session runs out (Supabase signs this tab out): the form stays, not the "Sign in" card.
    await become(SIGNED_OUT);
    expect(screen.queryByText("Sign in to apply as an organiser.")).toBeNull();
    expect(screen.getByLabelText("Organiser name")).toBe(nameField);
    expect(nameField).toHaveValue("Neon Collective");

    fireEvent.click(submit());
    expect(await screen.findByText(/Your session has expired/)).toBeInTheDocument();
    // Locked to the account that was filling it in (captured while signed in), not the live (gone) session.
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");

    // Signed in again in a new tab: back here, the organiser status loads again, and the form is still the same one.
    fireEvent.click(screen.getByRole("link", { name: "Sign in in a new tab" }));
    let finishLoading: () => void = () => {};
    getMyOrganiser.mockImplementationOnce(() => new Promise((_, reject) => (finishLoading = () => reject(NOT_FOUND))));
    await become(accountA("2026-10-25T10:00:00Z"));
    expect(screen.getByLabelText("Organiser name")).toBe(nameField);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Signed in again. Your changes are still here — submit when you’re ready.");
    await waitFor(() => expect(submit()).toHaveFocus());
    expect(screen.queryByText(/Your session has expired/)).toBeNull();

    await act(async () => finishLoading());
    expect(screen.getByLabelText("Organiser name")).toBe(nameField);
    expect(nameField).toHaveValue("Neon Collective");
    expect(screen.getByLabelText("Contact email")).toHaveValue("contact@example.com");

    fireEvent.click(submit());
    expect(await screen.findByText("Application pending")).toBeInTheDocument();
    expect(applyAsOrganiser).toHaveBeenCalledTimes(2);
  });

  it("never submits it as another account that signs in meanwhile, nor signs them out", async () => {
    const { become, signOut } = mount(accountA());
    await fillDraft();
    await become(SIGNED_OUT);
    // B's status is still loading: A's form is kept (for A's recovery), with A's draft.
    getMyOrganiser.mockImplementationOnce(() => new Promise(() => {}));
    await become(accountB);
    await waitFor(() => expect(getMyOrganiser).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Organiser name")).toHaveValue("Neon Collective");

    fireEvent.click(submit());
    expect(applyAsOrganiser).not.toHaveBeenCalled();
    expect(await screen.findByText(/Your session has expired/)).toBeInTheDocument();
    expect(screen.getByText(/^You're signed in as a different account/)).toHaveTextContent("Sign in as a@example.com");
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("once another account has loaded, it gets a new, empty form of its own (never the last one's draft)", async () => {
    const { become } = mount(accountA());
    await fillDraft();
    const nameField = screen.getByLabelText("Organiser name");
    await become(SIGNED_OUT);
    await become(accountB);
    // B has no application either: a form, but a new one.
    await waitFor(() => expect(screen.getByLabelText("Organiser name")).not.toBe(nameField));
    expect(screen.getByLabelText("Organiser name")).toHaveValue("");
    expect(screen.getByLabelText("Contact email")).toHaveValue("");
  });

  it("another account whose status fails to load sees its own error with Try again, not the last one's form", async () => {
    const { become } = mount(accountA());
    await fillDraft();
    await become(SIGNED_OUT);
    getMyOrganiser.mockRejectedValueOnce(new Error("Couldn't load your organiser status."));
    await become(accountB);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Organiser name")).toBeNull();
  });

  it("after the person's own Sign out (here or in another tab), the Sign in card, not the kept form", async () => {
    const { become } = mount(accountA());
    await fillDraft();
    await become({ ...SIGNED_OUT, signedOutBy: "user" });
    expect(screen.getByText("Sign in to apply as an organiser.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Organiser name")).toBeNull();
  });

  it("an application just submitted is only ever shown to the account that submitted it", async () => {
    applyAsOrganiser.mockResolvedValueOnce(PENDING);
    const { become } = mount(accountA());
    await fillDraft();
    fireEvent.click(submit());
    expect(await screen.findByText("Application pending")).toBeInTheDocument();
    await become(SIGNED_OUT);
    await become(accountB);
    // B has none: B's own (empty) form, not A's "pending".
    expect(await screen.findByLabelText("Organiser name")).toHaveValue("");
    expect(screen.queryByText("Application pending")).toBeNull();
  });

  it("someone arriving signed out still gets the Sign in card (nothing was on screen to keep)", async () => {
    mount(SIGNED_OUT);
    expect(screen.getByText("Sign in to apply as an organiser.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Organiser name")).toBeNull();
  });

  it("shows the next account's own status once it has loaded, never the last one's", async () => {
    const { become } = mount(accountA());
    await screen.findByLabelText("Organiser name");
    await become(SIGNED_OUT);
    getMyOrganiser.mockResolvedValueOnce({ ...PENDING, ownerUserId: "user-b" });
    await become(accountB);
    expect(await screen.findByText("Application pending")).toBeInTheDocument();
  });
});
