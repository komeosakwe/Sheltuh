import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_CREATORS } from "./home-content";
import { ArrowRightIcon } from "./icons";

/**
 * For organisers (mobile-redesign.md §6.3.1): an ink card (the scope inverts
 * its text and outline button). A 2:1 photo on phones keeps it short; from
 * 640px the photo is the right half. In Dark a 1px inset white edge keeps
 * the black card off the black page, as every card has.
 */
export default function CreatorsCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-creators" className={className}>
      <div data-surface="ink" className="overflow-hidden rounded-card sm:grid sm:grid-cols-2 dark:outline dark:-outline-offset-1 dark:outline-foreground">
        <EventArt
          poster={HOME_CREATORS.poster}
          imageUrl={HOME_CREATORS.imageUrl}
          title="For organisers"
          className="aspect-[2/1] sm:order-last sm:aspect-auto sm:h-full sm:min-h-64"
        />
        <div className="flex flex-col gap-2 p-5 sm:self-center sm:p-8">
          <p className="eyebrow text-muted">For organisers</p>
          <h2 id="home-creators" className="display-md">
            Bring your event to life
          </h2>
          <ButtonLink href="/organisers/apply" variant="outline" size="lg" className="mt-3 self-start">
            List your event
            <ArrowRightIcon />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
