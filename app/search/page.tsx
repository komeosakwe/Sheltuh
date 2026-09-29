import type { Metadata } from "next";
import EventFeed from "@/components/EventFeed";
import SearchBar from "@/components/SearchBar";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Search — Sheltüh" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 100) ?? "";

  return (
    <Page>
      <PageHeader
        eyebrow="Search"
        title={query ? `“${query}”` : "Find an event"}
        intro="Search events, venues, suburbs and organisers."
      />
      <div className="mb-12 max-w-2xl">
        <SearchBar defaultValue={query} size="lg" autoFocus={!query} />
      </div>
      {/* key: a new search starts a fresh feed with its own filters. */}
      <EventFeed key={query} query={query} />
    </Page>
  );
}
