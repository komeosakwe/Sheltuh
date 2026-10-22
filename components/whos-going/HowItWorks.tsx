/**
 * How Who's Going works, in the order access opens up, as the code does it
 * (lib/server/handlers/going.ts, WhosGoingProvider; docs/design/
 * mobile-redesign.md, Refinement 22 Oct 2026: moved here from the home's
 * band, so it's read where you'd act on it). Keep in step with /privacy.
 */
export const HOW_IT_WORKS_STEPS = [
  "Anyone can see how many are going, once three or more people have added themselves.",
  "Make a free profile with a verified email to see their names and faces. No ticket needed.",
  "Got a ticket? Add yourself to the list, only if you want to.",
  "Once you’re on the list, you can say hi to others going before the night.",
] as const;

/**
 * A native disclosure at the foot of the Who's Going panel: closed at first,
 * opened with the summary (Enter or Space, the browser's own behaviour), and
 * the page's focus ring on the summary.
 */
export default function HowItWorks() {
  return (
    <details data-how-it-works="" className="group/how mt-4">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm leading-5 font-semibold underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        How Who&rsquo;s Going works
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 group-open/how:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-sm leading-5 text-muted">
        {HOW_IT_WORKS_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
