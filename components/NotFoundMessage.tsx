import DotsMark from "@/components/brand/DotsMark";
import { ButtonLink } from "@/components/ui/Button";

/**
 * The 404 (docs/design/brand-direction-one.md §7): the two dots, the brand
 * question in the display face, one plain line and a way back to what's on.
 * Also the live event page's "no such event".
 */
export default function NotFoundMessage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-5 py-20 sm:px-8 sm:py-24">
      <DotsMark size="lg" className="text-foreground" />
      <h1 className="display-lg font-display mt-6">Lost?</h1>
      <p className="mt-4 max-w-md text-base leading-6 text-muted sm:text-lg sm:leading-7">
        That page isn&rsquo;t here. Try what&rsquo;s on this week.
      </p>
      <ButtonLink href="/events" size="lg" className="mt-8">
        See what&rsquo;s on
      </ButtonLink>
    </div>
  );
}
