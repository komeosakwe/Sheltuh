import Link from "next/link";
import { withNext } from "@/lib/safe-next-path";

/** Where "Find my tickets" goes: Help's "Where are my tickets?" (app/help/page.tsx). */
export const FIND_TICKETS_HREF = "/help#where-are-my-tickets";

/**
 * The end of /login's card (the sign-in mock): "New here? Create an account" (sign up, carrying
 * `next`) and "Find my tickets" (tickets are emailed; no account needed). 44px to tap.
 */
export default function LoginLinks({ next }: { next?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 body-s font-semibold">
      <p>
        New here?{" "}
        <Link href={withNext("/signup", next)} className="inline-flex min-h-11 items-center underline underline-offset-4">
          Create an account
        </Link>
      </p>
      <Link href={FIND_TICKETS_HREF} className="inline-flex min-h-11 items-center text-muted underline underline-offset-4">
        Find my tickets
      </Link>
    </div>
  );
}
