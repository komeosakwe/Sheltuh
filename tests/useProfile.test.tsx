// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { useProfile } from "@/lib/auth/useProfile";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** The signed-in account's Who's Going profile, one copy for the page (lib/auth/useProfile.ts, lib/auth/account-store.ts). */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getMyProfile = vi.fn();
vi.mock("@/lib/api/profiles", () => ({ getMyProfile: (...args: unknown[]) => getMyProfile(...args) }));

const profile = (displayName: string): ProfileRecord => ({
  displayName,
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  profileId: `pid-${displayName}`,
  profileVisible: false,
  hasAvatar: false,
});

const A: Partial<AuthContextValue> = { status: "signed-in", userId: "user-a", email: "a@example.com" };

function hook(auth: () => Partial<AuthContextValue>) {
  return renderHook(() => useProfile(), {
    wrapper: ({ children }) => <FakeAuthProvider value={fakeAuthValue(auth())}>{children}</FakeAuthProvider>,
  });
}

beforeEach(() => {
  getMyProfile.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  return () => vi.useRealTimers();
});

describe("useProfile", () => {
  it("a quiet check that fails (offline, a 5xx) keeps the profile a form is open on", async () => {
    getMyProfile.mockResolvedValueOnce(profile("Mia"));
    const first = hook(() => A);
    await waitFor(() => expect(first.result.current.state).toEqual({ status: "ready", profile: profile("Mia") }));
    vi.setSystemTime(Date.now() + 60_000);

    getMyProfile.mockRejectedValueOnce(new ApiError(502, "Bad gateway."));
    const later = hook(() => A);
    expect(later.result.current.state).toEqual({ status: "ready", profile: profile("Mia") });
    await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(first.result.current.state).toEqual({ status: "ready", profile: profile("Mia") });
    expect(later.result.current.state).toEqual({ status: "ready", profile: profile("Mia") });
  });

  it("an authoritative answer still lands: a changed profile, and one that's gone (404)", async () => {
    getMyProfile.mockResolvedValueOnce(profile("Mia"));
    const first = hook(() => A);
    await waitFor(() => expect(first.result.current.state).toMatchObject({ status: "ready" }));

    vi.setSystemTime(Date.now() + 60_000);
    getMyProfile.mockResolvedValueOnce(profile("Mia T."));
    hook(() => A);
    await waitFor(() => expect(first.result.current.state).toEqual({ status: "ready", profile: profile("Mia T.") }));

    vi.setSystemTime(Date.now() + 60_000);
    getMyProfile.mockRejectedValueOnce(new ApiError(404, "No profile."));
    hook(() => A);
    await waitFor(() => expect(first.result.current.state).toEqual({ status: "ready", profile: null }));
  });

  it("a first load that fails shows the error, and Try again that fails shows it again", async () => {
    getMyProfile.mockRejectedValueOnce(new ApiError(503, "Service unavailable."));
    const { result } = hook(() => A);
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Service unavailable." }));
    getMyProfile.mockRejectedValueOnce(new ApiError(503, "Still unavailable."));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Still unavailable." }));
  });
});
