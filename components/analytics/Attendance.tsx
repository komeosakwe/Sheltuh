import Link from "next/link";
import { Panel } from "@/components/ui/Section";
import { formatCount } from "@/lib/analytics-format";
import type { AnalyticsEventSummary, EventAttendance } from "@/lib/api/types";
import { backLinkClass } from "./shared";

/**
 * Door check-ins against tickets sold, all-time (docs/architecture.md,
 * "Organiser analytics" → Attendance). `attendance` is null until a ticket
 * sells, and absent from older responses (then nothing shows).
 */
export default function Attendance({
  attendance,
  event,
}: {
  attendance: EventAttendance | null | undefined;
  event: AnalyticsEventSummary;
}) {
  if (attendance === undefined) return null;
  const sold = attendance?.ticketsSold ?? 0;
  const checkedIn = attendance?.checkedIn ?? 0;
  const percent = sold > 0 ? Math.round((checkedIn / sold) * 100) : null;

  return (
    <Panel title="At the door" titleId="at-the-door">
      {attendance === null || sold === 0 ? (
        <p className="text-sm text-muted">No tickets have been sold yet, so there&rsquo;s no one to check in.</p>
      ) : (
        <dl className="flex flex-col gap-2">
          <dt className="eyebrow text-muted">Checked in</dt>
          <dd className="font-heading text-[1.75rem] leading-8 font-extrabold tabular-nums sm:text-[2.5rem] sm:leading-10">
            {formatCount(checkedIn)}
          </dd>
          <dd className="text-sm text-muted">
            of {formatCount(sold)} tickets sold{percent !== null && ` (${percent}%)`}. All time, whatever the dates above.
          </dd>
        </dl>
      )}
      {event.status === "published" && (
        <Link href={`/dashboard/${encodeURIComponent(event.eventId)}/check-in`} className={`${backLinkClass} mt-2`}>
          Open door check-in
        </Link>
      )}
    </Panel>
  );
}
