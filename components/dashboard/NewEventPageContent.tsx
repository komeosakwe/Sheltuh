"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import EventEditor from "@/components/dashboard/EventEditor";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

export default function NewEventPageContent() {
  const auth = useAuth();
  const router = useRouter();
  const { loading, organiser } = useOrganiser();

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (auth.status !== "signed-in" || !organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="mb-3 text-foreground">You need an approved organiser application to create events.</p>
        <Link href="/organisers/apply" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
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
