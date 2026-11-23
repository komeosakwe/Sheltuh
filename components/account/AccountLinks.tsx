import Link from "next/link";
import { ChevronRightIcon } from "@/components/home/icons";

export interface AccountLink {
  href: string;
  label: string;
  /** A short line under the label (Label/Tag, text/secondary), as the Settings frames' rows have. */
  note?: string;
}

/** The events row: Your events (organisers), Organise events (the way to apply), or none while it isn't known. */
export type AccountEventsRow = "events" | "apply" | null;

export const EVENTS_ROWS: Record<Exclude<AccountEventsRow, null>, AccountLink> = {
  events: { href: "/dashboard", label: "Your events" },
  apply: { href: "/organisers/apply", label: "Organise events" },
};

/**
 * A Settings card's rows of links (the Settings frames' setting rows: Body/S Strong over an
 * optional Label/Tag line, the row's control on the right; here a chevron, since each row goes
 * to a page). A labelled nav, each row one link, at least 48px tall, divided by 1px border/subtle.
 */
export default function AccountLinks({ label, links }: { label: string; links: AccountLink[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col">
        {links.map((link) => (
          <li key={link.href} className="border-b border-surface-border last:border-b-0">
            <Link
              href={link.href}
              className="group/row flex min-h-12 items-center justify-between gap-4 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="body-s font-semibold group-hover/row:underline group-hover/row:underline-offset-4">
                  {link.label}
                </span>
                {link.note && <span className="label-tag text-muted">{link.note}</span>}
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
