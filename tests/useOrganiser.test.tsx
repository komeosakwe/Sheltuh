// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { announceOrganiserChange, useOrganiser } from "@/lib/auth/useOrganiser";
import { fakeAuthValue, FakeAuthProvider, switchableSession } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({ getMyOrganiser: (...args: unknown[]) => getMyOrganiser(...args) }));

const record = (ownerUserId: string, status: OrganiserRecord["status"]): OrganiserRecord => ({
  ownerUserId,
  organiserId: `org-${ownerUserId}`,
  displayName: "Org",
  contactEmail: "org@example.com",
  description: "d",
  categories: ["live-music"],
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const A: Partial<AuthContextValue> = { status: "signed-in", userId: "user-a", email: "a@example.com", accessToken: "a1" };
const B: Partial<AuthContextValue> = { status: "signed-in", userId: "user-b", email: "b@example.com", accessToken: "b1" };

function hook(initial: Partial<AuthContextValue>) {
  let auth = initial;
  // Stable, as AuthProvider's is.
  const getAccessToken = vi.fn().mockResolvedValue("token");
  const view = renderHook(() => useOrganiser(), {
    wrapper: ({ children }) => (
      <FakeAuthProvider value={fakeAuthValue({ getAccessToken, ...auth })}>{children}</FakeAuthProvider>
    ),
  });
  return {
    result: view.result,
    become: (next: Partial<AuthContextValue>) => {
      auth = next;
      view.rerender();
    },
  };
}

beforeEach(() => {
  getMyOrganiser.mockReset();
});

describe("useOrganiser", () => {
  it("shows a record saved elsewhere on the page (a new logo) without refetching; another organiser's is ignored", async () => {
    getMyOrganiser.mockResolvedValueOnce(record("user-a", "approved"));
    const { result } = hook(A);
    await waitFor(() => expect(result.current.organiser?.ownerUserId).toBe("user-a"));
    act(() => announceOrganiserChange({ ...record("user-a", "approved"), logoUrl: "/api/organisers/org-user-a/logo?v=2" }));
    expect(result.current.organiser?.logoUrl).toBe("/api/organisers/org-user-a/logo?v=2");
    act(() => announceOrganiserChange({ ...record("user-b", "approved"), logoUrl: "/b.png" }));
    expect(result.current.organiser?.organiserId).toBe("org-user-a");
    expect(getMyOrganiser).toHaveBeenCalledTimes(1);
  });

  it("loads the signed-in account's own; after a switch it's loading again, never showing the last account's", async () => {
    getMyOrganiser.mockResolvedValueOnce(record("user-a", "approved"));
    const { result, become } = hook(A);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.organiser?.ownerUserId).toBe("user-a"));

    become({ status: "signed-out", userId: undefined, email: undefined, accessToken: undefined });
    expect(result.current).toMatchObject({ loading: false, organiser: null, error: null });

    let resolveB: (value: OrganiserRecord) => void = () => {};
    getMyOrganiser.mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)));
    become(B);
    expect(result.current).toMatchObject({ loading: true, organiser: null });
    await act(async () => resolveB(record("user-b", "pending")));
    expect(result.current).toMatchObject({ loading: false, organiser: { ownerUserId: "user-b", status: "pending" } });
  });

  it("fetches nothing on a token refresh", async () => {
    getMyOrganiser.mockRejectedValue(new ApiError(404, "Not found."));
    const { result, become } = hook(A);
    await waitFor(() => expect(result.current.loading).toBe(false));
    become({ ...A, accessToken: "a2" });
    expect(getMyOrganiser).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ loading: false, organiser: null, error: null });
  });

  it("refetch keeps what's shown while it runs (refreshing), rather than going back to loading", async () => {
    getMyOrganiser.mockResolvedValueOnce(record("user-a", "pending"));
    const { result } = hook(A);
    await waitFor(() => expect(result.current.organiser?.status).toBe("pending"));

    let resolve: (value: OrganiserRecord) => void = () => {};
    getMyOrganiser.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.refetch();
    });
    expect(result.current).toMatchObject({ loading: false, refreshing: true, organiser: { status: "pending" } });
    await act(async () => {
      resolve(record("user-a", "approved"));
      await done;
    });
    expect(result.current).toMatchObject({ loading: false, refreshing: false, organiser: { status: "approved" } });
  });

  it("is one copy for the page: readers mounted together share one request", async () => {
    getMyOrganiser.mockResolvedValue(record("user-a", "approved"));
    const getAccessToken = vi.fn().mockResolvedValue("token");
    const seen: (string | undefined)[] = [];
    function Reader() {
      seen.push(useOrganiser().organiser?.status);
      return null;
    }
    render(
      <FakeAuthProvider value={fakeAuthValue({ getAccessToken, ...A })}>
        <Reader />
        <Reader />
        <Reader />
      </FakeAuthProvider>,
    );
    await waitFor(() => expect(seen.at(-1)).toBe("approved"));
    expect(getMyOrganiser).toHaveBeenCalledTimes(1);
  });

  it("a reader mounted later (a dashboard tab switch) has the record at once, never loading, and it's checked again quietly", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      getMyOrganiser.mockResolvedValueOnce(record("user-a", "pending"));
      const first = hook(A);
      await waitFor(() => expect(first.result.current.organiser?.status).toBe("pending"));
      vi.setSystemTime(Date.now() + 60_000);

      let resolve: (value: OrganiserRecord) => void = () => {};
      getMyOrganiser.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
      const later = hook(A);
      expect(later.result.current).toMatchObject({ loading: false, organiser: { status: "pending" } });
      expect(getMyOrganiser).toHaveBeenCalledTimes(2);
      await act(async () => resolve(record("user-a", "approved")));
      // Every reader gets the fresher answer.
      expect(later.result.current.organiser?.status).toBe("approved");
      expect(first.result.current.organiser?.status).toBe("approved");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetch reaches every reader (after a join approves the organiser)", async () => {
    getMyOrganiser.mockResolvedValueOnce(record("user-a", "pending"));
    const header = hook(A);
    const page = hook(A);
    await waitFor(() => expect(header.result.current.organiser?.status).toBe("pending"));
    getMyOrganiser.mockResolvedValueOnce(record("user-a", "approved"));
    await act(async () => {
      await page.result.current.refetch();
    });
    expect(header.result.current.organiser?.status).toBe("approved");
  });

  it("the person's own Sign out forgets it; a session that expired keeps it for the same account's return", async () => {
    getMyOrganiser.mockResolvedValue(record("user-a", "approved"));
    const { result, become } = hook(A);
    await waitFor(() => expect(result.current.organiser?.status).toBe("approved"));

    let resolve: (value: OrganiserRecord) => void = () => {};
    getMyOrganiser.mockImplementation(() => new Promise((r) => (resolve = r)));
    become({ status: "signed-out", signedOutBy: "session", userId: undefined, email: undefined, accessToken: undefined });
    become(A);
    expect(result.current).toMatchObject({ loading: false, organiser: { status: "approved" } });
    await act(async () => resolve(record("user-a", "approved")));

    become({ status: "signed-out", signedOutBy: "user", userId: undefined, email: undefined, accessToken: undefined });
    become(A);
    expect(result.current).toMatchObject({ loading: true, organiser: null });
    await act(async () => resolve(record("user-a", "approved")));
    expect(result.current).toMatchObject({ loading: false, organiser: { status: "approved" } });
  });

  it("a quiet check that fails (offline, a 5xx) keeps the record a page is showing; one that answers still lands", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      getMyOrganiser.mockResolvedValueOnce(record("user-a", "approved"));
      const first = hook(A);
      await waitFor(() => expect(first.result.current.organiser?.status).toBe("approved"));
      vi.setSystemTime(Date.now() + 60_000);

      getMyOrganiser.mockRejectedValueOnce(new ApiError(503, "Service unavailable."));
      const later = hook(A);
      await waitFor(() => expect(getMyOrganiser).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(first.result.current).toMatchObject({ loading: false, organiser: { status: "approved" }, error: null });
      expect(later.result.current).toMatchObject({ loading: false, organiser: { status: "approved" }, error: null });

      // An authoritative answer still lands: the application is gone (404).
      vi.setSystemTime(Date.now() + 60_000);
      getMyOrganiser.mockRejectedValueOnce(new ApiError(404, "Not found."));
      hook(A);
      await waitFor(() => expect(first.result.current).toMatchObject({ loading: false, organiser: null, error: null }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a first load that fails shows the error", async () => {
    getMyOrganiser.mockRejectedValueOnce(new ApiError(503, "Service unavailable."));
    const { result } = hook(A);
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, organiser: null, error: "Service unavailable." }));
  });

  it("asks as the account it files the answer under: when the session is someone else's by then, nothing is kept or cleared", async () => {
    const session = switchableSession({ userId: "user-a" });
    getMyOrganiser.mockImplementation(async (getToken: () => Promise<string>) => {
      const token = await getToken();
      return record(token === "user-a-token" ? "user-a" : "user-b", "approved");
    });
    let auth: Partial<AuthContextValue> = A;
    const view = renderHook(() => useOrganiser(), {
      wrapper: ({ children }) => <FakeAuthProvider value={fakeAuthValue({ ...auth, ...session.auth })}>{children}</FakeAuthProvider>,
    });
    await waitFor(() => expect(view.result.current.organiser?.ownerUserId).toBe("user-a"));
    expect(session.auth.getAccessTokenFor).toHaveBeenLastCalledWith({ userId: "user-a", email: "a@example.com" });

    // B signs in in another tab; this page still says A when its refetch asks for a token.
    session.become({ userId: "user-b" });
    await act(async () => {
      await view.result.current.refetch();
    });
    // B's token was never used for A's record, and A's own record wasn't cleared.
    expect(getMyOrganiser).toHaveBeenCalledTimes(2);
    expect(view.result.current).toMatchObject({ loading: false, organiser: { ownerUserId: "user-a" }, error: null });

    // The page catches up: B's own is asked for (as B), and A's is never shown for B.
    auth = B;
    view.rerender();
    expect(view.result.current).toMatchObject({ loading: true, organiser: null });
    await waitFor(() => expect(view.result.current.organiser?.ownerUserId).toBe("user-b"));
    expect(session.auth.getAccessTokenFor).toHaveBeenLastCalledWith({ userId: "user-b", email: "b@example.com" });
  });
});
