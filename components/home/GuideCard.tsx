import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_GUIDE } from "./home-content";
import { ArrowRightIcon } from "./icons";
import SectionHead from "@/components/ui/SectionHead";

/** "After dark": one static editorial card, white with a black border (not itself a link; its button is). */
export default function GuideCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-guide" className={className}>
      <SectionHead id="home-guide" title="After dark" />
      <div className="overflow-hidden rounded-card border border-foreground bg-card sm:grid sm:grid-cols-2">
        <EventArt
          poster={HOME_GUIDE.poster}
          imageUrl={HOME_GUIDE.imageUrl}
          title={HOME_GUIDE.title}
          className="aspect-video sm:aspect-auto sm:h-full sm:min-h-64"
        />
        <div className="flex flex-col gap-2 p-4 sm:self-center sm:p-8">
          <p className="eyebrow text-muted">{HOME_GUIDE.eyebrow}</p>
          <h3 className="display-md">{HOME_GUIDE.title}</h3>
          <p className="text-sm leading-5 text-muted sm:text-base sm:leading-6">{HOME_GUIDE.body}</p>
          <ButtonLink href={HOME_GUIDE.cta.href} size="lg" className="mt-3 self-start">
            {HOME_GUIDE.cta.label}
            <ArrowRightIcon />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
