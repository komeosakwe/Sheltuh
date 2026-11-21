import Link from "next/link";
import { shownCount, type AccountNavItem } from "./useAccountNav";

/**
 * The Account tabs row under the header on tablet and mobile (Latte's 1120 frames: the "Account
 * tab" component 518:9727 and the rows on every tablet / mobile account page): Profile · My
 * tickets · Saved · Messages · Settings. A nav of links (each goes to a page), not ARIA tabs: the
 * current one has aria-current="page", Body/S Strong in text/primary with a 2px foreground
 * underline; the others are text/secondary. Counts sit in a grey pill (surface/muted, Mono/S),
 * unread messages in an orange one (black number, 6.18:1); the number is aria-hidden and its
 * meaning is read after the label (", 3 unread"). 24px between tabs, 16px in from the sides on
 * phones and 24px from 768px, a 1px border/subtle line under the row. The frames clip the row at
 * 390; here it scrolls sideways (the handoff, 3.1), without a scrollbar. Each tab is 44px tall.
 */
export default function AccountTabs({ items }: { items: AccountNavItem[] }) {
  return (
    <nav aria-label="Account" data-account-tabs="" className="border-b border-surface-border">
      <ul className="no-scrollbar flex gap-6 overflow-x-auto px-4 md:px-6">
        {items.map((item) => (
          <li key={item.key} className="flex shrink-0">
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              data-account-tab={item.key}
              className={`body-s flex min-h-11 items-center gap-2 border-b-2 py-3 font-semibold whitespace-nowrap focus-visible:-outline-offset-2 hover:text-foreground ${
                item.current ? "border-foreground text-foreground" : "border-transparent text-muted"
              }`}
            >
              {/* The count's words sit in the label's box, so the link is named "Saved, 12 events". */}
              <span>
                {item.label}
                {item.countText && <span className="sr-only">{item.countText}</span>}
              </span>
              {item.count !== null && (
                <span
                  aria-hidden="true"
                  data-account-count=""
                  className={`rounded-badge px-2 font-mono text-xs leading-4 font-normal text-foreground tabular-nums ${
                    item.alert ? "bg-signal text-signal-foreground" : "bg-surface"
                  }`}
                >
                  {shownCount(item.count)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
