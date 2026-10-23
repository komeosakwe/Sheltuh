import type { Metadata } from "next";
import SavedPageContent from "@/components/favourites/SavedPageContent";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Saved — Sheltüh" };

export default function SavedPage() {
  return (
    <Page>
      <PageHeader size="md" eyebrow="Your list" title="Saved" intro="Events you've saved. Only you can see this list." />
      <SavedPageContent />
    </Page>
  );
}
