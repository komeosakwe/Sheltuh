import type { Metadata } from "next";
import Link from "next/link";
import NewEventPageContent from "@/components/dashboard/NewEventPageContent";

export const metadata: Metadata = { title: "New event — Sheltüh" };

export default function NewEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-accent underline underline-offset-2">
        &larr; Back to your events
      </Link>
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">New event</h1>
      <NewEventPageContent />
    </div>
  );
}
