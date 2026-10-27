"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import OrganiserSubNav from "./OrganiserSubNav";

/**
 * Every organiser page's frame (app/dashboard/layout.tsx), as AdminShell is
 * the admin pages'. A signed-in approved organiser gets the organiser
 * sub-nav, then the page. Anyone else (signed out, an applicant, the demo,
 * still loading) gets the page alone: each page says why there's nothing to
 * manage, and the sub-nav would only lead to more of the same.
 */
export default function OrganiserShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { organiser } = useOrganiser();
  const approved = auth.configured && auth.status === "signed-in" && organiser?.status === "approved";

  return (
    <>
      {approved && <OrganiserSubNav />}
      {children}
    </>
  );
}
