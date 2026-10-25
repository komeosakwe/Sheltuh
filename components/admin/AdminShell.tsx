"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import AdminGate from "./AdminGate";
import { AdminOwnerProvider } from "./AdminSessionExpired";
import AdminSubNav from "./AdminSubNav";

/**
 * Every admin page's frame (app/admin/layout.tsx). An admin gets the admin
 * sub-nav, then the page. Anyone else (signed out, a member, the demo, still
 * loading) gets an "Admin" heading and AdminGate's message instead, and no
 * admin page is rendered at all.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const isAdmin = auth.configured && auth.status === "signed-in" && auth.isAdmin;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
        <div className="flex max-w-2xl flex-col gap-8">
          <PageHeader flush size="md" eyebrow="Sheltüh" title="Admin" />
          {/* No admin content inside: AdminGate only shows why there's none. */}
          <AdminGate>{null}</AdminGate>
        </div>
      </div>
    );
  }

  // The admin these pages are open as: an expired-session sign-in is locked to them.
  return (
    <AdminOwnerProvider>
      <AdminSubNav />
      {children}
    </AdminOwnerProvider>
  );
}
