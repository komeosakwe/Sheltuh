import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import { EVENT_MESSAGES_HREF } from "@/components/admin/AdminSubNav";
import EmailOutbox from "@/components/admin/EmailOutbox";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Emails — Sheltüh admin" };

export default function AdminEmailsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Emails"
      intro={
        <>
          Failed sends retry for about 9 hours (6 attempts), then wait here for a manual resend. Organisers&rsquo;
          messages to ticket holders are under{" "}
          <Link href={EVENT_MESSAGES_HREF} className="font-semibold underline underline-offset-4 hover:decoration-2">
            Event messages
          </Link>
          .
        </>
      }
    >
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <EmailOutbox />
      </Suspense>
    </AdminPage>
  );
}
