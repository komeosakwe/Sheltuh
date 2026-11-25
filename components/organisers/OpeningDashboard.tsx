"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Page } from "@/components/ui/Section";
import { useOptionalNavAccount } from "@/components/nav/useNavAccount";
import { OVERVIEW_HREF } from "@/lib/organiser-nav";

/** What the page's own application panel (ApplyPageContent) tells OpeningDashboard, and asks of it. */
interface OpeningDashboardValue {
  /** The panel's own load of the organiser record failed (true), or no longer has (false). */
  reportPanelError: (failed: boolean) => void;
  /** Sends the organiser on to /dashboard: once, whichever of the panel and OpeningDashboard asks first. */
  goToDashboard: () => void;
}

const OpeningDashboardContext = createContext<OpeningDashboardValue | null>(null);

/** OpeningDashboard around the panel, or null when the panel is rendered on its own (a test). */
export function useOpeningDashboard(): OpeningDashboardValue | null {
  return useContext(OpeningDashboardContext);
}

/**
 * The For organisers page's way past itself for an approved organiser (OrganisersPage): while the
 * account is a known organiser (NavAccount's knownOrganiser: their record says approved, or, while it
 * loads, this browser last showed them the organiser frame), "Opening your dashboard…" stands in for
 * the page, so it never flashes up before the redirect to /dashboard. The redirect comes from
 * whichever record says approved first, the nav's (here) or the panel's own (ApplyPageContent),
 * through goToDashboard, so it's sent once.
 *
 * The page stays mounted underneath, hidden, so it's simply shown, with nothing lost, when the hint
 * was stale (the nav's record says not approved) or when the panel's own load of the record failed
 * (its error and Try again are then on the page). Signed out, in the demo, on the server and while
 * hydrating, it's never known, so the page is what renders first (search engines and first paint
 * as before).
 */
export default function OpeningDashboard({ children }: { children: ReactNode }) {
  const account = useOptionalNavAccount();
  const router = useRouter();
  const [panelFailed, setPanelFailed] = useState(false);
  // The nav's own record says approved (not just the hint).
  const approved = account !== null && account.knownOrganiser && !account.organiser.loading;
  // The panel's failed load shows the page, unless the nav's record is already sending them on.
  const opening = (account?.knownOrganiser ?? false) && (approved || !panelFailed);

  const sent = useRef(false);
  const goToDashboard = useCallback(() => {
    if (sent.current) return;
    sent.current = true;
    router.replace(OVERVIEW_HREF);
  }, [router]);

  useEffect(() => {
    if (approved) goToDashboard();
  }, [approved, goToDashboard]);

  const value = useMemo<OpeningDashboardValue>(() => ({ reportPanelError: setPanelFailed, goToDashboard }), [goToDashboard]);

  return (
    <OpeningDashboardContext.Provider value={value}>
      {opening && (
        <Page width="narrow">
          {/* The page's heading while this stands in for the For organisers page (hidden, below). */}
          <h1 className="sr-only">Opening your dashboard</h1>
          <div className="flex flex-col gap-6">
            <LoadingState text="Opening your dashboard…" announce />
            {approved && (
              <Link href={OVERVIEW_HREF} className={buttonClass("solid", "md", "self-start")}>
                Go to your dashboard
              </Link>
            )}
          </div>
        </Page>
      )}
      {/* No box of its own while shown (display: contents), so the page lays out as before. */}
      <div hidden={opening} className={opening ? undefined : "contents"}>
        {children}
      </div>
    </OpeningDashboardContext.Provider>
  );
}
