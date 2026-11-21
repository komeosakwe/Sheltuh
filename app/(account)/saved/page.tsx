import type { Metadata } from "next";
import AccountPageHead from "@/components/account/AccountPageHead";
import SavedPageContent from "@/components/favourites/SavedPageContent";

export const metadata: Metadata = { title: "Saved — Sheltüh" };

export default function SavedPage() {
  return (
    <>
      <AccountPageHead title="Saved" intro="Events you’ve saved for later." />
      <SavedPageContent />
    </>
  );
}
