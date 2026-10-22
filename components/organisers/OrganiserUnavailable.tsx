import type { Ref } from "react";
import DemoNotice from "@/components/DemoNotice";
import { ButtonLink } from "@/components/ui/Button";

/**
 * An organiser profile that can't be shown: unknown, not (or no longer)
 * approved, or (`demo`) not one of the demo's sample organisers.
 * `headingRef` makes the h1 focusable from script (tabIndex -1).
 */
export default function OrganiserUnavailable({
  demo = false,
  headingRef,
}: {
  demo?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="mx-auto flex max-w-6xl *:max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="display-lg outline-offset-2">
        This organiser isn&rsquo;t available
      </h1>
      {demo ? (
        <DemoNotice>This demo only has the organisers of its sample events.</DemoNotice>
      ) : (
        <p className="text-muted">
          The link may be out of date, or the organiser&rsquo;s profile isn&rsquo;t public right now.
        </p>
      )}
      <ButtonLink href="/events" size="lg">
        Browse all events
      </ButtonLink>
    </div>
  );
}
