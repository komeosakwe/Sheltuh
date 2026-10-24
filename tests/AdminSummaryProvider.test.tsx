// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SUMMARY_POLL_MS, AdminSummaryProvider } from "@/components/admin/AdminSummaryProvider";
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

function renderNav(auth: AuthContextValue) {
  return render(
    <FakeAuthProvider value={auth}>
      <AdminSummaryProvider>
        <Nav />
      </AdminSummaryProvider>
    </FakeAuthProvider>,
  );
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

  it("stops asking once the API says they're not an admin", async () => {
    adminGetSummary.mockRejectedValue(new ApiError(403, "Admins only."));
    renderNav(fakeAuthValue({ isAdmin: true }));
    await advance(0);
    await advance(ADMIN_SUMMARY_POLL_MS * 3);
    expect(adminGetSummary).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-admin-badge]")).toBeNull();
  });
});
