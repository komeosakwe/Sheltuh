import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import { initialsFor } from "@/lib/initials";

const SIZES = {
  /** The sidebar's 112px circle: initials SemiBold 32/40 (Heading/H2; 28/36 in the phone drawer). */
  sidebar: "size-28 heading-h2",
  /** The rail's 40px circle: initials Medium 12/16. */
  rail: "size-[40px] text-xs leading-4 font-medium",
} as const;

/**
 * The organiser's mark at the top of the sidebar and the rail (Latte's "Org / Sidebar" Avatar):
 * a round orange disc with their initials in black (6.18:1), or their logo filling the circle when
 * they've uploaded one (shown only once approved, when the logo is public). The logo is the
 * site's OrganiserLogo, so a logo that fails to load (a takedown, say; even before hydration)
 * gives the initials back. With no name yet (the record still loading) it's the bare disc. Decorative: the name beside it (or the nav's own name, on the rail) is
 * what's read.
 */
export default function OrganiserAvatar({
  name,
  logoUrl,
  size,
}: {
  name: string;
  logoUrl?: string;
  size: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden="true"
      data-organiser-mark={size}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-signal text-signal-foreground ${SIZES[size]}`}
    >
      <OrganiserLogo name={name} url={logoUrl} size="fill" shape="round" fallback="none" fallbackElement={name ? initialsFor(name) : null} />
    </span>
  );
}
