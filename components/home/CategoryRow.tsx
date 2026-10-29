import Link from "next/link";
import { filterChipClass } from "@/components/ui/FilterChip";
import ScrollHint from "@/components/ui/ScrollHint";
import CategoryIcon, { type CategoryIconName } from "./CategoryIcon";

/** Every link opens /events with that filter already applied (see app/events/page.tsx). */
export const HOME_CATEGORIES: { label: string; href: string; icon: CategoryIconName }[] = [
  { label: "Live music", href: "/events?category=live-music", icon: "music" },
  { label: "Art", href: "/events?category=art", icon: "art" },
  { label: "Workshops", href: "/events?category=workshop", icon: "workshop" },
  { label: "Pop-ups", href: "/events?category=pop-up", icon: "pop-up" },
  { label: "Theatre", href: "/events?category=theatre", icon: "theatre" },
  { label: "Free", href: "/events?pricing=free", icon: "free" },
];

/**
 * Browse by category (docs/design/mobile-redesign.md, Refinement 22 Oct
 * 2026; it replaces the six category boxes): one compact row of chips under
 * the hero's search, "All events" first, then each category, each opening
 * /events with that filter applied. On a phone the row scrolls sideways
 * inside its own container (bleeding to the screen edges, so the page never
 * does); from 640px it wraps. Chips are 44px tall on phones (40px from
 * 640px), in the /events filter chips' look. A labelled nav, no heading: the
 * chips say what they are.
 */
export default function CategoryRow({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Browse by category" className={className}>
      <ScrollHint className="-mx-5 sm:mx-0" fadeClassName="sm:hidden">
        <ul className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-5 py-1 sm:flex-wrap sm:overflow-visible sm:px-0">
          <li className="flex shrink-0">
            <Link href="/events" className={filterChipClass(false, "font-semibold")}>
              All events
            </Link>
          </li>
          {HOME_CATEGORIES.map((item) => (
            <li key={item.href} className="flex shrink-0">
              <Link href={item.href} className={filterChipClass(false)}>
                <CategoryIcon name={item.icon} className="h-4 w-4" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </ScrollHint>
    </nav>
  );
}
