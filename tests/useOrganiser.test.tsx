// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

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
});
