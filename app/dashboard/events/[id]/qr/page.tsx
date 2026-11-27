import type { Metadata } from "next";
import { Suspense } from "react";
import EventQrCode from "@/components/dashboard/EventQrCode";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Event QR code — Sheltüh" };

export default async function EventQrPage({ params }: PageProps<"/dashboard/events/[id]/qr">) {
  const { id } = await params;
  return (
    <Page padding="subNav">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventQrCode eventId={id} />
      </Suspense>
    </Page>
  );
}
