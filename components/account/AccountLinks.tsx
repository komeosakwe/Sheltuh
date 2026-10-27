import Link from "next/link";
import { ChevronRightIcon } from "@/components/home/icons";

interface AccountLink {
  href: string;
  label: string;
}

/** The events row: Your events (organisers), Organise events (the way to apply), or none while it isn't known. */
export type AccountEventsRow = "events" | "apply" | null;

const EVENTS_ROWS: Record<Exclude<AccountEventsRow, null>, AccountLink> = {
  events: { href: "/dashboard", label: "Your events" },
  apply: { href: "/organisers/apply", label: "Organise events" },
};

/**
 * The rest of the account, as a short list of single-line link rows (48px,
 * a chevron on the right): Your events for organisers (Organise events, to
 * apply, for everyone else), then Organisers you follow, Messages and
 * Blocked members. A labelled nav, each row a link.
 */
export default function AccountLinks({ events }: { events: AccountEventsRow }) {
  const links: AccountLink[] = [
    ...(events ? [EVENTS_ROWS[events]] : []),
    { href: "/following", label: "Organisers you follow" },
    { href: "/messages", label: "Messages" },
    { href: "/messages/blocked", label: "Blocked members" },
  ];
  return (
    <nav aria-label="Your account" className="border-t border-foreground">
      <ul>
        {links.map((link) => (
          <li key={link.href} className="border-b border-surface-border">
            <Link
              href={link.href}
              className="flex min-h-12 items-center justify-between gap-4 text-base font-semibold hover:underline hover:underline-offset-4"
            >
              {link.label}
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
