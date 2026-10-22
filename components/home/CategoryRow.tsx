import Link from "next/link";
import CategoryIcon, { type CategoryIconName } from "./CategoryIcon";
import SectionHead from "./SectionHead";

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
 * "Explore by category" (docs/design/mobile-redesign.md §6.3.6): its own
 * section after the event sections, six bordered tiles in a grid (three
 * across on phones, so two rows and no sideways scroll; one row from 640px).
 * No "See all": it's the index.
 */
export default function CategoryRow({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="home-cats" className={className}>
      <SectionHead id="home-cats" title="Explore by category" />
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        {HOME_CATEGORIES.map((item) => (
          <li key={item.href} className="flex">
            <Link
              href={item.href}
              className="flex min-h-18 w-full flex-col items-center justify-center gap-2 rounded-control border border-foreground bg-card px-2 py-3 text-center transition duration-150 hover:bg-surface motion-safe:active:scale-95"
            >
              <CategoryIcon name={item.icon} />
              <span className="text-xs leading-4 font-semibold">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
