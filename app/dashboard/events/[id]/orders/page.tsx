import type { Metadata } from "next";
import { Suspense } from "react";
import EventOrders from "@/components/dashboard/EventOrders";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Event orders — Sheltüh" };

export default async function EventOrdersPage({ params }: PageProps<"/dashboard/events/[id]/orders">) {
  const { id } = await params;
  return (
    <Page padding="subNav">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventOrders eventId={id} />
      </Suspense>
    </Page>
  );
}
