"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { NotApprovedOrganiser } from "@/components/analytics/AnalyticsGate";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";
import DoorConsole, { checkInPath, pageClass } from "./DoorConsole";

/**
 * /dashboard/[eventId]/check-in (docs/design/check-in.md): the organiser's
 * door scanner, on an ink surface (`data-door`) for dark venues. This is the
 * gate: demo mode, loading, signed out and not an approved organiser use the
 * shared states, which re-skin in the door scope.
 */
export default function CheckInPage({ eventId }: { eventId: string }) {
  const doorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={doorRef} data-door="" className="flex min-h-svh flex-col">
      <Gate eventId={eventId} doorRef={doorRef} />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className={pageClass}>{children}</div>;
}

function Gate({ eventId, doorRef }: { eventId: string; doorRef: RefObject<HTMLDivElement | null> }) {
  const auth = useAuth();
  const { loading, organiser, error } = useOrganiser();

  if (!auth.configured) {
    return (
      <Shell>
        <h1 className="display-md mb-6">Door check-in</h1>
        <Notice tone="danger" role="alert">
          Accounts aren&rsquo;t configured in this environment yet. Door check-in needs a live Sheltüh account.
        </Notice>
      </Shell>
    );
  }
  if (auth.status === "loading" || (auth.status === "signed-in" && loading)) {
    return (
      <Shell>
        <p className="text-sm text-muted">Loading…</p>
      </Shell>
    );
  }
  if (auth.status === "signed-out") {
    return (
      <Shell>
        <EmptyState
          headingLevel={1}
          title="Sign in to check people in"
          action={
            <ButtonLink size="lg" href={withNext("/login", checkInPath(eventId))}>
              Sign in
            </ButtonLink>
          }
        />
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <h1 className="display-md mb-6">Door check-in</h1>
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </Shell>
    );
  }
  if (!organiser || organiser.status !== "approved") {
    return (
      <Shell>
        <h1 className="display-md mb-6">Door check-in</h1>
        <NotApprovedOrganiser
          status={organiser?.status === "approved" ? undefined : organiser?.status}
          need="check people in at the door"
        />
      </Shell>
    );
  }
  return <DoorConsole eventId={eventId} getToken={auth.getAccessToken} doorRef={doorRef} />;
}
