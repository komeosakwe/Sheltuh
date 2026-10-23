"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HeartIcon from "./HeartIcon";

/**
 * The header's icon link to /saved, in every auth state (signed out, /saved
 * explains and offers sign in). `desktop` is 36px so the 70px row doesn't
 * grow; `compact` is the 44px phone/tablet bar size. The heart fills while
 * on /saved. No count badge.
 */
export default function SavedNavLink({ size }: { size: "desktop" | "compact" }) {
  const pathname = usePathname();
  const current = pathname === "/saved";
  return (
    <Link
      href="/saved"
      aria-label="Saved"
      aria-current={current ? "page" : undefined}
      className={
        size === "desktop"
          ? "flex size-9 items-center justify-center rounded-control text-foreground hover:bg-foreground hover:text-background"
          : "flex size-11 items-center justify-center text-foreground"
      }
    >
      <HeartIcon filled={current} className="size-5" />
    </Link>
  );
}
