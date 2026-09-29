import type { Metadata } from "next";
import AccountContent from "@/components/account/AccountContent";

export const metadata: Metadata = { title: "Account — Sheltüh" };

export default function AccountPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <h1 className="display-lg">Account</h1>
      <AccountContent />
    </div>
  );
}
