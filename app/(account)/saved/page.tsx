import type { Metadata } from "next";
import { SAVED_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";
import SavedPageContent from "@/components/favourites/SavedPageContent";

export const metadata: Metadata = { title: "Saved — Sheltüh" };

export default function SavedPage() {
  return (
    <>
      <AccountPageHead {...SAVED_HEAD} />
      <SavedPageContent />
    </>
  );
}
