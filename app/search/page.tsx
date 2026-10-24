import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import EventFeed from "@/components/EventFeed";
import SearchBar from "@/components/SearchBar";
import { Notice, Page, PageHeader } from "@/components/ui/Section";
import { didYouMean, findLocality, parseNearParam } from "@/lib/location";

export const metadata: Metadata = { title: "Search — Sheltüh" };

function searchHref(query: string, near: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("near", near);
  return `/search?${params.toString()}`;
}

/**
 * /search?q=…&near=…: the words go to the feed (and the API, live); `near`,
 * a suburb, orders the results by distance in the browser and is never sent
 * to the API (lib/location.ts). A suburb we don't know gets a notice and the
 * usual soonest-first results.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; near?: string | string[] }>;
}) {
  const { q, near: nearParam } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 100) ?? "";
  const near = parseNearParam(nearParam);
  // The bar leaves an empty `near` out of the address, once its script has run. A search sent
  // before that (or without JS) still carries `near=`: drop it, so the address stays /search?q=….
  if (nearParam !== undefined && !near) redirect(query ? `/search?${new URLSearchParams({ q: query })}` : "/search");
  const place = near ? findLocality(near) : null;
  const suggestion = near && !place ? didYouMean(near) : null;

  const title = place
    ? query
      ? `“${query}” near ${place.name}`
      : `Events near ${place.name}`
    : query
      ? `“${query}”`
      : "Find an event";

  return (
    <Page>
      <PageHeader
        eyebrow="Search"
        title={title}
        intro="Search events, venues and organisers. Add your suburb to see what’s close."
      />
      <div className="rise mb-12 max-w-2xl [--d:120ms]">
        <SearchBar
          defaultValue={query}
          near={near}
          size="lg"
          tone="signal"
          autoFocus={!query && !near}
          label="Search events"
        />
      </div>
      {near && !place && (
        <div className="mb-8">
          <Notice>
            We don’t know where “{near}” is yet, so these are soonest first.
            {suggestion && (
              <>
                {" "}
                Did you mean{" "}
                <Link href={searchHref(query, suggestion.name)} className="font-semibold underline underline-offset-4">
                  {suggestion.name}
                </Link>
                ?
              </>
            )}
          </Notice>
        </div>
      )}
      {/* key: a new search starts a fresh feed with its own filters. */}
      <EventFeed key={`${query}|${place?.name ?? ""}`} query={query} near={place?.name} />
    </Page>
  );
}
