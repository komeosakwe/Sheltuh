import type { Metadata } from "next";
import AccountContent from "@/components/account/AccountContent";
import AccountPageHead from "@/components/account/AccountPageHead";

export const metadata: Metadata = { title: "Settings — Sheltüh" };

export default function AccountPage() {
  return (
    <>
      <AccountPageHead tall title="Settings" intro="Your profile, privacy and sign-in." />
      <AccountContent />
    </>
  );
}
