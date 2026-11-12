import Strap from "@/components/ui/Strap";
import OrganiserPillarIcon from "./OrganiserPillarIcon";
import {
  HOW_IT_WORKS_ID,
  ORGANISER_PILLARS,
  PUBLISH_STEPS,
  STEPS_EYEBROW,
  STEPS_TITLE,
  WHY_EYEBROW,
  WHY_ROWS,
  WHY_STAT,
  WHY_TITLE,
} from "./organisers-content";

/**
 * Small orange text is only for black (the rules: orange text fails on white, 3.4:1): the mock's
 * orange straps and step numbers are muted on the White theme and orange on Dark (5.8:1 or more).
 */
const ACCENT_TEXT = "text-muted dark:text-signal";

/** Create, Reach and Grow: three cards under the hero, stacked on phones, a row from 768px. */
export function OrganiserPillars({ className = "" }: { className?: string }) {
  return (
    <ul className={`grid gap-4 md:grid-cols-3 ${className}`.trim()}>
      {ORGANISER_PILLARS.map((pillar) => (
        <li key={pillar.title} className="flex flex-col rounded-card border border-surface-border p-8">
          <span className="grid size-16 place-items-center rounded-control bg-hover">
            <OrganiserPillarIcon name={pillar.icon} />
          </span>
          <h2 className="mt-6 heading-h2">{pillar.title}</h2>
          <p className={`mt-2 eyebrow ${ACCENT_TEXT}`}>{pillar.strap}</p>
          <p className="mt-4 body-m text-muted">{pillar.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** "Publish your first event in four steps": a numbered list, one column on phones, two at 640px, four at 1024px. */
export function PublishSteps({ className = "" }: { className?: string }) {
  return (
    <section id={HOW_IT_WORKS_ID} aria-labelledby="how-it-works-title" className={className}>
      <Strap label={STEPS_EYEBROW} rule={false} />
      <h2 id="how-it-works-title" className="mt-4 heading-xl text-balance">
        {STEPS_TITLE}
      </h2>
      <ol className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-x-6 lg:mt-12 lg:grid-cols-4">
        {PUBLISH_STEPS.map((step, i) => (
          <li key={step.title} className="border-t-2 border-foreground pt-6">
            <span aria-hidden="true" className={`mono-s ${ACCENT_TEXT}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-4 heading-h3">{step.title}</h3>
            <p className="mt-2 body-m text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Why Sheltüh?": the heading and the interviews' figure (13 of 15, read as one sentence) on the
 * left from 1024px, and the four reasons as a description list on the right.
 */
export function WhySheltuh({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="why-title" className={`lg:grid lg:grid-cols-12 lg:gap-8 ${className}`.trim()}>
      <div className="lg:col-span-5">
        <Strap label={WHY_EYEBROW} rule={false} />
        <h2 id="why-title" className="mt-4 heading-xl text-balance">
          {WHY_TITLE}
        </h2>
        <p className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          {/* Orange at display size only (3.4:1 passes for large text). */}
          <span className="shrink-0 figure-xl text-signal">{WHY_STAT.figure}</span>{" "}
          <span className="body-m font-medium text-muted sm:max-w-64">{WHY_STAT.caption}</span>
        </p>
      </div>
      <dl className="mt-12 border-b border-surface-border lg:col-span-7 lg:mt-0">
        {WHY_ROWS.map((row) => (
          <div key={row.title} className="grid gap-2 border-t border-surface-border py-6 sm:grid-cols-5 sm:gap-6">
            <dt className="heading-h3 sm:col-span-2">{row.title}</dt>
            <dd className="body-m text-muted sm:col-span-3">{row.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
