import Link from "next/link";

/**
 * What adding yourself means, shown at the point of choice. Proposed copy:
 * needs product/legal sign-off before launch (docs/design/whos-going.md §5.2).
 * Keep it in step with the Who's Going and Messages sections of /privacy.
 */
export default function ConsentCopy({ id, className = "text-sm leading-5" }: { id?: string; className?: string }) {
  return (
    <p id={id} className={className}>
      People signed in to Sheltüh will see your display name and initials on this event&rsquo;s page.
      People who aren&rsquo;t signed in only see how many are going. We never show your email or
      ticket details. Others who&rsquo;ve added themselves to this event can send you a message
      request: one message, and nothing more unless you reply. You can decline, block or report
      anyone. Your display name is saved so you can add yourself to other events in one tap,
      and it&rsquo;s the same on every event you join, so signed-in members can see which events
      you&rsquo;ve joined. You can remove yourself from this event at any time on this page, or delete
      your profile from your account to leave every event.{" "}
      <Link href="/privacy#whos-going" className="underline underline-offset-4 hover:decoration-2">
        How we handle your information
      </Link>
    </p>
  );
}
