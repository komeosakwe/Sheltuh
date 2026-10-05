import type { Metadata } from "next";
import Link from "next/link";
import { BlockedPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Blocked members — Sheltüh" };

export default function BlockedMembersPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link
        href="/messages"
        className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:decoration-2"
      >
        <span aria-hidden="true">&larr;&nbsp;</span>All messages
      </Link>
      <h1 className="display-lg">Blocked members</h1>
      <BlockedPageContent />
    </div>
  );
}
