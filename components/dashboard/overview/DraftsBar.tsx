import Link from "next/link";
import { eventCount } from "@/lib/organiser-dashboard";

/**
 * The Overview's "Drafts" bar (Latte 430:7340): black (an ink section in both themes), radius 16,
 * 24 in, "Drafts · 2 events" in SemiBold 16/24 white and "Continue →" in SemiBold 14/20 orange
 * (6.18:1 on black). "Continue →" is the link, to the Events tab's drafts, and its hit area covers
 * the bar. Not shown without drafts.
 */
export default function DraftsBar({ count, href }: { count: number; href: string }) {
  if (count <= 0) return null;
  return (
    <div data-surface="ink" data-drafts-bar="" className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card p-6">
      <p className="label-button">Drafts · {eventCount(count)}</p>
      <Link
        href={href}
        aria-label={`Continue your drafts (${eventCount(count)})`}
        className="body-s inline-flex items-center gap-1 font-semibold text-signal underline-offset-4 after:absolute after:inset-0 after:rounded-card after:content-[''] hover:underline"
      >
        Continue
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
