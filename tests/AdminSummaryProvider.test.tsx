// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SUMMARY_POLL_MS, AdminSummaryProvider, useAdminSummary } from "@/components/admin/AdminSummaryProvider";
import Nav from "@/components/Nav";
import { ApiError } from "@/lib/api/client";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { adminSummary } from "./test-utils/fakeAdminSummary";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
const adminGetSummary = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminGetSummary: (...args: unknown[]) => adminGetSummary(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  adminGetSummary.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** What the provider gives its readers, and a way to ask it to check again (as an admin action does). */
function Probe() {
  const context = useAdminSummary();
  return (
    <>
      <p data-testid="probe">
        {JSON.stringify({ failed: context?.failed, denied: context?.denied, emails: context?.summary?.emailsFailed.count })}
      </p>
      <button type="button" onClick={() => context?.refresh()}>
        Refresh
      </button>
    </>
  );
}

function renderNav(auth: AuthContextValue) {
  return render(
    <FakeAuthProvider value={auth}>
      <AdminSummaryProvider>
        <Nav />
        <Probe />
      </AdminSummaryProvider>
    </FakeAuthProvider>,
  );
}

const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as Record<string, unknown>;

/** A promise to settle later, for answers that arrive out of order. */
function later<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const adminLinks = () => screen.getAllByRole("link", { name: /^Admin/, hidden: true });

describe("Admin badge in the main nav", () => {
  it("shows an admin what needs them, on Admin in the desktop row and the phone menu, in the link's name", async () => {
    adminGetSummary.mockResolvedValue(
      adminSummary({
        reportsOpen: { count: 2, oldestAt: null },
        organisersPending: { count: 1, oldestAt: null },
        emailsRetrying: { count: 9 },
        doorEvents: { count: 3, windowHours: 24 },
      }),
    );
    renderNav(fakeAuthValue({ isAdmin: true, email: "admin@sheltuh.example" }));
    await advance(0);
    const links = adminLinks();
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAccessibleName("Admin, 3 waiting");
      expect(link.querySelector("[data-admin-badge]")).toHaveTextContent("3");
    }
  });

  it("checks again every minute, and shows no badge when nothing is waiting", async () => {
    adminGetSummary.mockResolvedValueOnce(adminSummary({ emailsFailed: { count: 1 } })).mockResolvedValue(adminSummary());
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    expect(adminLinks()[0]).toHaveAccessibleName("Admin, 1 waiting");
    await advance(ADMIN_SUMMARY_POLL_MS);
    expect(adminGetSummary).toHaveBeenCalledTimes(2);
    expect(adminLinks()[0]).toHaveAccessibleName("Admin");
    expect(document.querySelector("[data-admin-badge]")).toBeNull();
  });

  it("never asks for a member, or in the demo", async () => {
    renderNav(fakeAuthValue({ isAdmin: false }));
    await advance(ADMIN_SUMMARY_POLL_MS * 2);
    cleanup();
    renderNav(fakeAuthValue({ configured: false, status: "signed-out", isAdmin: false }));
    await advance(ADMIN_SUMMARY_POLL_MS * 2);
    expect(adminGetSummary).not.toHaveBeenCalled();
  });

  it("stops asking once the API says they're not an admin (403), and says so to its readers", async () => {
    adminGetSummary.mockRejectedValue(new ApiError(403, "Admins only."));
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    await advance(ADMIN_SUMMARY_POLL_MS * 3);
    expect(adminGetSummary).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-admin-badge]")).toBeNull();
    expect(probe()).toMatchObject({ denied: true, failed: false });
  });

  it("keeps asking after a 401 (signed out elsewhere, or a token refresh): the next check can work", async () => {
    adminGetSummary
      .mockResolvedValueOnce(adminSummary({ emailsFailed: { count: 2 } }))
      .mockRejectedValueOnce(new ApiError(401, "Sign in."))
      .mockResolvedValue(adminSummary({ emailsFailed: { count: 3 } }));
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    await advance(ADMIN_SUMMARY_POLL_MS);
    // The failed check keeps the last counts, marked as possibly out of date.
    expect(probe()).toMatchObject({ denied: false, failed: true, emails: 2 });
    await advance(ADMIN_SUMMARY_POLL_MS);
    expect(adminGetSummary).toHaveBeenCalledTimes(3);
    expect(probe()).toMatchObject({ denied: false, failed: false, emails: 3 });
  });

  it("only the latest check sets the counts: an older one answering last is ignored", async () => {
    const first = later<ReturnType<typeof adminSummary>>();
    const second = later<ReturnType<typeof adminSummary>>();
    adminGetSummary.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    // An admin action asks again while the first check is still out.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(adminGetSummary).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(adminSummary({ emailsFailed: { count: 1 } }));
    });
    expect(adminLinks()[0]).toHaveAccessibleName("Admin, 1 waiting");
    await act(async () => {
      first.resolve(adminSummary({ emailsFailed: { count: 7 } }));
    });
    expect(adminLinks()[0]).toHaveAccessibleName("Admin, 1 waiting");
    expect(probe()).toMatchObject({ emails: 1 });
  });

  it("an older check failing after a newer one answered doesn't mark the counts as failed", async () => {
    const first = later<ReturnType<typeof adminSummary>>();
    let failFirst: (err: unknown) => void = () => {};
    adminGetSummary
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
      )
      .mockReturnValueOnce(first.promise);
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => {
      first.resolve(adminSummary({ emailsFailed: { count: 4 } }));
    });
    await act(async () => {
      failFirst(new ApiError(503, "Busy."));
    });
    expect(probe()).toMatchObject({ failed: false, emails: 4 });
  });
});
