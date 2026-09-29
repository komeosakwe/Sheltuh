import Link from "next/link";

/**
 * What adding yourself means, shown at the point of choice. Proposed copy:
 * needs product/legal sign-off before launch (docs/design/whos-going.md §5.2).
 */
export default function ConsentCopy({ id, className = "text-sm leading-5" }: { id?: string; className?: string }) {
  return (
    <p id={id} className={className}>
      People signed in to Sheltüh will see your display name and initials on this event&rsquo;s page.
      People who aren&rsquo;t signed in only see how many are going. We never show your email or
      ticket details. You can remove yourself at any time, here or from your account.{" "}
      <Link href="/privacy" className="underline underline-offset-4 hover:decoration-2">
        How we handle your information
      </Link>
    </p>
  );
}
