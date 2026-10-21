import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import { BlockedPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Blocked members — Sheltüh" };

export default function BlockedMembersPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <BackLink href="/messages">All messages</BackLink>
      <PageHeader flush size="md" eyebrow="Messages" title="Blocked members" />
      <BlockedPageContent />
    </div>
  );
}
