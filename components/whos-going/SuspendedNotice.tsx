import { SUPPORT_EMAIL } from "@/lib/contact";

/** Shown to a member whose display name Sheltüh has hidden (suspended), on the event page and /account. */
export default function SuspendedNotice() {
  return (
    <>
      Your display name is hidden from Who&rsquo;s Going. If you think that&rsquo;s a mistake, email{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4 hover:decoration-2">
        {SUPPORT_EMAIL}
      </a>
      .
    </>
  );
}
