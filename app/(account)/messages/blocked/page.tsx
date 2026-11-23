import type { Metadata } from "next";
import AccountPageHead from "@/components/account/AccountPageHead";
import BackLink from "@/components/ui/BackLink";
import { BlockedPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Blocked members — Sheltüh" };

export default function BlockedMembersPage() {
  return (
    <>
      <BackLink href="/messages">All messages</BackLink>
      <AccountPageHead title="Blocked members" intro="People who can’t message you or see your conversations." />
      <div className="max-w-2xl">
        <BlockedPageContent />
      </div>
    </>
  );
}
