import Link from "next/link";
import { ChevronRightIcon } from "@/components/home/icons";

interface AccountLink {
  href: string;
  label: string;
}

/**
 * The rest of the account, as a short list of single-line link rows (48px,
 * a chevron on the right): Your events for organisers, then Organisers you
 * follow, Messages and Blocked members. A labelled nav, each row a link.
 */
export default function AccountLinks({ showEvents }: { showEvents: boolean }) {
  const links: AccountLink[] = [
    ...(showEvents ? [{ href: "/dashboard", label: "Your events" }] : []),
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
