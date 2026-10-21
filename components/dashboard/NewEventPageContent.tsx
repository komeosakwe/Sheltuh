"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import EventEditor from "@/components/dashboard/EventEditor";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";

export default function NewEventPageContent() {
  const auth = useAuth();
  const router = useRouter();
  const { loading, organiser } = useOrganiser();

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || loading) {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status !== "signed-in" || !organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3 text-foreground">You need an approved organiser application to create events.</p>
        <Link href="/organisers/apply" className="btn btn-solid">
          Apply as an organiser
        </Link>
      </div>
    );
  }

  return (
    <EventEditor
      getToken={auth.getAccessToken}
      onSaved={(record) => router.push(`/dashboard/${record.eventId}`)}
    />
  );
}
