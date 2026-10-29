import type { Metadata } from "next";
import AdminHub from "@/components/admin/AdminHub";
import { PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Admin — Sheltüh" };

/** The admin hub (gated, with the sub-nav, by app/admin/layout.tsx). */
export default function AdminHomePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12">
      <PageHeader
        flush
        size="md"
        eyebrow="Sheltüh"
        title="Admin"
      />
      <AdminHub />
    </div>
  );
}
