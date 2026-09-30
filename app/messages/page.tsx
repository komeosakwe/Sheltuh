import type { Metadata } from "next";
import Link from "next/link";
import { InboxPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Messages — Sheltüh" };

export default function MessagesPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="display-lg">Messages</h1>
        <Link
          href="/messages/blocked"
          className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:decoration-2 sm:self-auto"
        >
          Blocked members
        </Link>
      </div>
      <InboxPageContent />
    </div>
  );
}
