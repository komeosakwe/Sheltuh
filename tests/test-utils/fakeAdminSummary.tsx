import type { ReactNode } from "react";
import { vi } from "vitest";
import { AdminSummaryContext, type AdminSummaryContextValue } from "@/components/admin/AdminSummaryProvider";
import type { AdminSummary } from "@/lib/api/types";

/** An admin summary with nothing waiting, for tests to override. */
export function adminSummary(overrides: Partial<AdminSummary> = {}): AdminSummary {
  return {
    reportsOpen: { count: 0, oldestAt: null },
    eventsPending: { count: 0, soonestStartsAt: null, startingSoon: 0, startingSoonHours: 72 },
    organisersPending: { count: 0, oldestAt: null },
    emailsFailed: { count: 0 },
    emailsRetrying: { count: 0 },
    doorEvents: { count: 0, windowHours: 24 },
    ...overrides,
  };
}

/** A fixed admin summary for components that read it (no polling). `refresh` is a spy. */
export function FakeAdminSummaryProvider({
  value,
  children,
}: {
  value: Partial<AdminSummaryContextValue>;
  children: ReactNode;
}) {
  return (
    <AdminSummaryContext.Provider value={{ summary: null, failed: false, refresh: vi.fn(), ...value }}>
      {children}
    </AdminSummaryContext.Provider>
  );
}
