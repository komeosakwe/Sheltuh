import Link from "next/link";
import { Notice } from "@/components/ui/Section";
import { withNext } from "@/lib/safe-next-path";
import { SESSION_EXPIRED_MESSAGE } from "./shared";

/**
 * A failed action's message, announced as an alert. When the session has
 * expired it adds a "Sign in" link that comes back to `returnTo`.
 *
 * `announce={false}` drops the alert role, for a notice that takes focus
 * instead (focus reads it out; an alert as well would say it twice).
 */
export default function ActionErrorNotice({
  message,
  returnTo,
  announce = true,
}: {
  message: string;
  returnTo: string;
  announce?: boolean;
}) {
  return (
    <Notice tone="danger" role={announce ? "alert" : undefined}>
      {message}
      {message === SESSION_EXPIRED_MESSAGE && (
        <>
          {" "}
          <Link href={withNext("/login", returnTo)} className="underline underline-offset-4 hover:decoration-2">
            Sign in
          </Link>
        </>
      )}
    </Notice>
  );
}
