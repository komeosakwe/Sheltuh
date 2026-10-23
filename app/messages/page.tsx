import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import Link from "next/link";
import { InboxPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Messages — Sheltüh" };

export default function MessagesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <PageHeader
          flush
          size="md"
          eyebrow="Your account"
          title="Messages"
          action={
            <Link
              href="/messages/blocked"
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:decoration-2"
            >
              Blocked members
            </Link>
          }
        />
        <InboxPageContent />
      </div>
    </div>
  );
}
