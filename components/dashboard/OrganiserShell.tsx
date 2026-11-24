"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import DashFrame from "@/components/dashboard/ui/DashFrame";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { isFullScreenOrganiserPath } from "@/lib/organiser-nav";
import { OrganiserRail, OrganiserSidebar } from "./OrganiserNav";

/**
 * Every organiser page's frame (app/dashboard/layout.tsx), in Latte's dashboard frames: the
 * shared dashboard frame (DashFrame, the customer account area's too) with the organiser's black
 * sidebar on a desktop and its collapsed rail (and drawer) below 1024px, then the page.
 *
 * Only a signed-in approved organiser gets it. Anyone else (signed out, an applicant, the demo,
 * still loading) gets the page alone: each page says why there's nothing to manage, and the nav
 * would only lead to more of the same. The door scanner and the seat-map editor are full-screen
 * surfaces with their own way back, so they're never framed.
 *
 * Inside the frame the page's own container (ui/Section `Page`) gives up its gutters and width
 * (globals.css, [data-organiser-main] > [data-page]): the frame's main column spaces the page.
 */
export default function OrganiserShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname() ?? "";
  const { organiser } = useOrganiser();
  const approved = auth.configured && auth.status === "signed-in" && organiser?.status === "approved";

  const framed = approved && organiser !== null && !isFullScreenOrganiserPath(pathname);

  // Always the same frame, `bare` when unframed, so the page isn't remounted when the organiser's
  // record arrives (DashboardContent's one-time welcome after joining would be lost).
  return (
    <DashFrame
      area="organiser"
      bare={!framed}
      sidebar={framed && organiser ? <OrganiserSidebar organiser={organiser} pathname={pathname} /> : null}
      rail={framed && organiser ? <OrganiserRail organiser={organiser} pathname={pathname} /> : null}
    >
      {children}
    </DashFrame>
  );
}
