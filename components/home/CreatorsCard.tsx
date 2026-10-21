import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_CREATORS } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** The organiser pitch: an ink card (the scope inverts its text and outline button), the guide's split mirrored. */
export default function CreatorsCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-creators" data-reveal className={className}>
      <div data-surface="ink" className="overflow-hidden rounded-card sm:grid sm:grid-cols-2">
        <EventArt
          poster={HOME_CREATORS.poster}
          imageUrl={HOME_CREATORS.imageUrl}
          title="For creators"
          className="aspect-video sm:order-last sm:aspect-auto sm:h-full sm:min-h-64"
        />
        <div className="flex flex-col gap-2 p-5 sm:self-center sm:p-8">
          <p className="eyebrow text-muted">For creators</p>
          <h2 id="home-creators" className="display-md">
            Bring your event to life
          </h2>
          <p className="text-sm leading-5 text-muted sm:text-base sm:leading-6">
            Reach people who go out for culture. Every listing is reviewed by a person, and fees are shown up front.
          </p>
          <ButtonLink href="/organisers/apply" variant="outline" size="lg" className="mt-3 self-start">
            List your event
            <ArrowRightIcon />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
