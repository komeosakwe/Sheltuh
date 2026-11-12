import { HOW_IT_WORKS_STEPS } from "@/components/whos-going/HowItWorks";
import { PANEL_LINE, WHO_SEES_YOU } from "./community-content";

/**
 * "You choose who sees you" (the proposal's panel, redesign PR 3): its title and line, then how
 * Who's Going really works, the event page's own steps (components/whos-going/HowItWorks.tsx,
 * kept in step with /privacy), in a white card. A cream panel (--hover), as Local discovery's. Text only: no sample toggle and no count, since
 * opting in happens on an event's page, with a ticket.
 */
export default function WhoSeesYou({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="community-who" className={`rounded-card bg-hover p-6 md:p-8 lg:p-12 ${className}`.trim()}>
      <h2 id="community-who" className="heading-h1">
        {WHO_SEES_YOU.title}
      </h2>
      <p className={PANEL_LINE}>{WHO_SEES_YOU.body}</p>
      <ol data-how-it-works-steps="" className="mt-6 flex flex-col gap-4 rounded-card bg-card p-4 md:p-6">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <li key={step} className="flex gap-4">
            <span aria-hidden="true" className="mono-m shrink-0 text-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="body-m">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
