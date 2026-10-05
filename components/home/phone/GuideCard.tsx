import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_GUIDE } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** "Only in the city": one static editorial card (not itself a link; its button is). */
export default function GuideCard({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-guide" className={className}>
      <h2 id="home-guide" className="mb-3 text-[1.375rem] leading-7 normal-case">
        Only in the city
      </h2>
      <div className="overflow-hidden rounded-card bg-card shadow-card">
        <EventArt
          poster={HOME_GUIDE.poster}
          imageUrl={HOME_GUIDE.imageUrl}
          title={HOME_GUIDE.title}
          className="aspect-video"
        />
        <div className="flex flex-col gap-2 p-4">
          <p className="eyebrow text-muted">{HOME_GUIDE.eyebrow}</p>
          <h3 className="text-[1.375rem] leading-7 normal-case">{HOME_GUIDE.title}</h3>
          <p className="text-sm leading-5 text-muted">{HOME_GUIDE.body}</p>
          <ButtonLink href={HOME_GUIDE.cta.href} size="lg" className="mt-2 self-start">
            {HOME_GUIDE.cta.label}
            <ArrowRightIcon />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
