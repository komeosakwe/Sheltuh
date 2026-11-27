import type { Metadata } from "next";
import { Suspense } from "react";
import EventQrSignPage from "@/components/dashboard/EventQrSignPage";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Printable sign — Sheltüh" };

export default async function EventQrSignRoute({ params }: PageProps<"/dashboard/events/[id]/qr/sign">) {
  const { id } = await params;
  return (
    <Page padding="subNav">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventQrSignPage eventId={id} />
      </Suspense>
    </Page>
  );
}
