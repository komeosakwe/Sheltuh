import Link from "next/link";
import CategoryIcon, { type CategoryIconName } from "./CategoryIcon";

/** Every chip opens /events with that filter already applied (see app/events/page.tsx). */
export const HOME_CATEGORIES: { label: string; href: string; icon: CategoryIconName }[] = [
  { label: "Live music", href: "/events?category=live-music", icon: "music" },
  { label: "Art", href: "/events?category=art", icon: "art" },
  { label: "Workshops", href: "/events?category=workshop", icon: "workshop" },
  { label: "Pop-ups", href: "/events?category=pop-up", icon: "pop-up" },
  { label: "Theatre", href: "/events?category=theatre", icon: "theatre" },
  { label: "Free", href: "/events?pricing=free", icon: "free" },
];

/** A thumb-scrolled row of round category links. */
export default function CategoryRow({ className = "" }: { className?: string }) {
  return (
    <nav aria-labelledby="home-cats" className={className}>
      <h2 id="home-cats" className="sr-only">
        Browse by category
      </h2>
      {/* py-1.5 keeps the focus ring clear of the scroll container's clip. */}
      <ul className="no-scrollbar -mx-5 -my-1.5 flex snap-x snap-proximity scroll-px-5 gap-2 overflow-x-auto px-5 py-1.5">
        {HOME_CATEGORIES.map((item) => (
          <li key={item.href} className="shrink-0 snap-start">
            <Link
              href={item.href}
              className="group flex w-18 flex-col items-center gap-1.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-95"
            >
              <span className="flex size-12 items-center justify-center rounded-full border border-surface-border bg-card transition-colors duration-150 group-hover:bg-foreground group-hover:text-background">
                <CategoryIcon name={item.icon} />
              </span>
              <span className="text-center text-xs leading-4 font-medium">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
