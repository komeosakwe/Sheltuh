import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import AccountContent from "@/components/account/AccountContent";

export const metadata: Metadata = { title: "Account — Sheltüh" };

export default function AccountPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <PageHeader flush size="md" eyebrow="Your account" title="Account" />
      <AccountContent />
    </div>
  );
}
