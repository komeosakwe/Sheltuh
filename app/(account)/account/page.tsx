import type { Metadata } from "next";
import AccountContent from "@/components/account/AccountContent";
import { SETTINGS_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";

export const metadata: Metadata = { title: "Settings — Sheltüh" };

export default function AccountPage() {
  return (
    <>
      <AccountPageHead {...SETTINGS_HEAD} />
      <AccountContent />
    </>
  );
}
