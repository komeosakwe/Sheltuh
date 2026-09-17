import type { Metadata } from "next";
import Link from "next/link";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";

export const metadata: Metadata = { title: "Edit event — Sheltüh" };

export default function EditEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-accent underline underline-offset-2">
        &larr; Back to your events
      </Link>
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Edit event</h1>
      <EditEventPageContent />
    </div>
  );
}
