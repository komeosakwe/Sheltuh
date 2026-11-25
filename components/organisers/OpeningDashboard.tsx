"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Page } from "@/components/ui/Section";
import { useOptionalNavAccount } from "@/components/nav/useNavAccount";
import { OVERVIEW_HREF } from "@/lib/organiser-nav";

/**
 * The For organisers page's way past itself for an approved organiser (OrganisersPage): while the
 * account is a known organiser (NavAccount's knownOrganiser: their record says approved, or, while it
 * loads, this browser last showed them the organiser frame), "Opening your dashboard…" stands in for
 * the page, so it never flashes up before ApplyPageContent's redirect to /dashboard. The page stays
 * mounted underneath, hidden, so a stale hint (the record says not approved) simply shows it, with
 * nothing lost. Signed out, in the demo, on the server and while hydrating, it's never known, so the
 * page is what renders first (search engines and first paint as before).
 */
export default function OpeningDashboard({ children }: { children: ReactNode }) {
  const account = useOptionalNavAccount();
  const opening = account?.knownOrganiser ?? false;
  // Once the record itself says approved: a way on, if the redirect is slow or blocked.
  const approved = opening && account !== null && !account.organiser.loading;

  return (
    <>
      {opening && (
        <Page width="narrow">
          <div className="flex flex-col gap-6">
            <LoadingState text="Opening your dashboard…" />
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
    </>
  );
}
