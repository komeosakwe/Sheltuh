"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import EventEditor from "@/components/dashboard/EventEditor";
import { useAuth } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";

export default function NewEventPageContent() {
  const auth = useAuth();
  const router = useRouter();
  const { loading, organiser } = useOrganiser();
  const approved = auth.status === "signed-in" && organiser?.status === "approved";
  // The editor was on screen: kept while the session has run out (or another
  // account's status is loading), so the new draft stays mounted and its own
  // recovery can sign in again in place. Not after the person's own Sign out;
  // keyed by account, so another account gets a new, empty editor.
  const editor = useKeptWhileSignedOut(approved, auth.status === "signed-in" && !loading);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (editor?.value) {
    return (
      <EventEditor
        key={editor.account}
        getToken={auth.getAccessToken}
        payoutsEnabled={organiser ? organiser.payoutsEnabled === true : undefined}
        organiserHasLogo={organiser ? Boolean(organiser.logoUrl) : undefined}
        organiserName={organiser?.displayName}
        onSaved={(record) => router.push(`/dashboard/${record.eventId}`)}
      />
    );
  }

  if (auth.status === "loading" || loading) {
    return <LoadingState text="Loading…" />;
  }

  return (
    <div className="rounded-card border border-foreground bg-card p-4">
      <p className="mb-3 text-foreground">You need an approved organiser application to create events.</p>
      <Link href="/organisers/apply" className="btn btn-solid">
        Apply as an organiser
      </Link>
    </div>
  );
}
