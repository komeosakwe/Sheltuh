import Link from "next/link";
import DemoNotice from "@/components/DemoNotice";
import EventBrowser from "@/components/EventBrowser";
import { getEventCategories, getEvents } from "@/lib/data";

export default async function DiscoverPage() {
  const [events, categories] = await Promise.all([getEvents(), getEventCategories()]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl text-foreground sm:text-5xl">
          Melbourne&rsquo;s creative events, curated
        </h1>
        <p className="max-w-2xl text-muted">
          Live music, art, workshops and pop-ups from independent Melbourne organisers.{" "}
          <Link href="/organisers/submit" className="text-accent underline underline-offset-2">
            Running one yourself? Submit it.
          </Link>
        </p>
        <DemoNotice>
          These are fictional sample listings for this local prototype — no real tickets are
          on sale.
        </DemoNotice>
      </div>

      <EventBrowser events={events} categories={categories} />
    </div>
  );
}
