"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import DashFrame from "@/components/dashboard/ui/DashFrame";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { rememberFramed, wasFramed } from "@/lib/organiser-frame-hint";
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
 * On a fresh load the organiser's record arrives a moment after the page: for an account this browser
 * last showed the frame (lib/organiser-frame-hint.ts) the frame is kept in place meanwhile, with
 * the places but no name yet, so the page doesn't jump into it.
 *
 * Inside the frame the page's own container (ui/Section `Page`) gives up its gutters and width
 * (globals.css, [data-organiser-main] > [data-page]): the frame's main column spaces the page.
 */
const noSubscription = () => () => {};

/** The frame's sidebar and rail while the organiser's record loads: the places, no name or mark yet. */
const LOADING_ORGANISER = { displayName: "" };

export default function OrganiserShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname() ?? "";
  const { organiser, loading } = useOrganiser();
  const signedIn = auth.configured && auth.status === "signed-in";
  const userId = signedIn ? auth.userId : undefined;
  const approved = signedIn && organiser?.status === "approved";
  const fullScreen = isFullScreenOrganiserPath(pathname);
  const hinted = useSyncExternalStore(noSubscription, () => wasFramed(userId), () => false);

  useEffect(() => {
    if (signedIn && !loading) rememberFramed(userId, approved);
  }, [signedIn, loading, userId, approved]);

  const shown = approved && organiser ? organiser : signedIn && loading && hinted ? LOADING_ORGANISER : null;
  const framed = shown !== null && !fullScreen;

  // Always the same frame, `bare` when unframed, so the page isn't remounted when the organiser's
  // record arrives (DashboardContent's one-time welcome after joining would be lost).
  return (
    <DashFrame
      area="organiser"
      bare={!framed}
      sidebar={framed && shown ? <OrganiserSidebar organiser={shown} pathname={pathname} /> : null}
      rail={framed && shown ? <OrganiserRail organiser={shown} pathname={pathname} /> : null}
    >
      {children}
    </DashFrame>
  );
}
