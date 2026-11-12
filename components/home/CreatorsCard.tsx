import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_CREATORS } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** The banner's line (the proposal's, word for word; true: an admin approves every organiser, §7). */
export const CREATORS_LINE = "Every organiser checked by a person · Only the good stuff";

/**
 * "Bring your event to life" (the proposal, redesign PR 3): the home's last section, a black
 * banner (an ink section, so its text and outline button invert) in both themes. The eyebrow,
 * the h2, the proposal's one line, a licensed photo (decorative) and "List your event" to the
 * organiser application. Stacked on phones (the photo first, 2:1); from 1024px one row, the
 * photo (400px, 3:1) between the words and the button. In Dark a 1px inset white edge keeps the black banner
 * off the black page.
 */
export default function CreatorsCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-creators" className={className}>
      <div
        data-surface="ink"
        className="flex flex-col gap-6 overflow-hidden rounded-card p-6 md:p-8 lg:flex-row lg:items-center lg:gap-8 lg:px-12 dark:outline dark:-outline-offset-1 dark:outline-foreground"
      >
        <div className="flex flex-col gap-2 lg:flex-1">
          <p className="eyebrow text-muted">For organisers</p>
          <h2 id="home-creators" className="heading-h1">
            Bring your event to life
          </h2>
          <p className="body-s font-medium text-muted">{CREATORS_LINE}</p>
        </div>
        <div aria-hidden="true" className="order-first overflow-hidden rounded-card lg:order-none lg:w-100 lg:shrink-0">
          <EventArt poster={HOME_CREATORS.poster} imageUrl={HOME_CREATORS.imageUrl} title="" className="aspect-[2/1] w-full lg:aspect-[3/1]" />
        </div>
        <ButtonLink href="/organisers/apply" variant="outline" className="self-start lg:self-auto">
          List your event
          <ArrowRightIcon className="size-4 shrink-0" />
        </ButtonLink>
      </div>
    </section>
  );
}
