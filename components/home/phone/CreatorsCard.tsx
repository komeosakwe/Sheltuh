import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_CREATORS } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** The organiser pitch: a dark card, the one place on the phone home with a light-on-dark button. */
export default function CreatorsCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-creators" className={className}>
      <div className="overflow-hidden rounded-card bg-foreground text-background">
        <EventArt
          poster={HOME_CREATORS.poster}
          imageUrl={HOME_CREATORS.imageUrl}
          title="For creators"
          className="aspect-video"
        />
        <div className="flex flex-col gap-2 p-5">
          <p className="eyebrow text-background/70">For creators</p>
          <h2 id="home-creators" className="text-[1.375rem] leading-7 normal-case">
            Bring your event to life
          </h2>
          <p className="text-sm leading-5 text-background/70">
            Reach people who go out for culture. Every listing is reviewed by a person, and fees are shown up front.
          </p>
          <ButtonLink
            href="/organisers/apply"
            variant="light"
            size="lg"
            className="mt-3 self-start focus-visible:outline-background"
          >
            List your event
            <ArrowRightIcon />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
