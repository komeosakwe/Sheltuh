import type { Metadata } from "next";
import Link from "next/link";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";

export const metadata: Metadata = { title: "Edit event — Sheltüh" };

export default function EditEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/dashboard" className="text-sm text-accent underline underline-offset-2">
        &larr; Back to your events
      </Link>
      <h1 className="display-lg">Edit event</h1>
      <EditEventPageContent />
    </div>
  );
}
