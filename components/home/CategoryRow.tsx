import Link from "next/link";
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
 * The home chips' look (owner's mockup, 8 Nov 2026): 44px pills (40px from 640px), "All events" solid
 * black (white in Dark), each category outlined with its icon. They're links to /events, never a
 * selection, so nothing here is pressed or current.
 */
const CHIP = "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border text-sm leading-5 sm:h-10";
const ALL_CHIP = `${CHIP} border-foreground bg-foreground px-5 font-semibold text-background hover:bg-accent-strong`;
const CATEGORY_CHIP = `${CHIP} border-foreground/50 ps-4.5 pe-4 font-medium text-foreground hover:border-foreground hover:bg-surface`;

/**
 * Browse by category (docs/design/mobile-redesign.md, Refinement 22 Oct
 * 2026; it replaces the six category boxes): one compact row of chips under
 * the hero's search, "All events" first, then each category, each opening
 * /events with that filter applied. On a phone the row scrolls sideways
 * inside its own container (bleeding to the screen edges, so the page never
 * does); from 640px it wraps. Chips are 44px tall on phones (40px from
 * 640px), as pills (the owner's mockup, 8 Nov 2026: CHIP). A labelled nav, no heading: the
 * chips say what they are.
 */
export default function CategoryRow({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Browse by category" className={className}>
      <ScrollHint className="-mx-5 sm:mx-0" fadeClassName="sm:hidden">
        <ul className="no-scrollbar flex gap-2.5 overflow-x-auto overscroll-x-contain px-5 py-1 sm:flex-wrap sm:overflow-visible sm:px-0">
          <li className="flex shrink-0">
            <Link href="/events" className={ALL_CHIP}>
              All events
            </Link>
          </li>
          {HOME_CATEGORIES.map((item) => (
            <li key={item.href} className="flex shrink-0">
              <Link href={item.href} className={CATEGORY_CHIP}>
                <CategoryIcon name={item.icon} className="size-5" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </ScrollHint>
    </nav>
  );
}
