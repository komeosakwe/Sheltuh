"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthNavLinks from "@/components/AuthNavLinks";

const ORANGE = "#e15b27";

export default function Nav() {
  const pathname = usePathname();

  function linkClassName(href: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return `rounded px-3 py-2 font-medium transition-colors hover:bg-surface ${
      active ? "underline decoration-2 underline-offset-8" : "text-foreground"
    }`;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="font-heading text-3xl tracking-wide text-foreground">
          Shelt<span style={{ color: ORANGE }}>ü</span>h
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-2 text-sm sm:gap-4">
          <Link href="/" className={linkClassName("/")} style={pathname === "/" ? { color: ORANGE } : undefined}>
            Discover
          </Link>
          <Link href="/map" className={linkClassName("/map")} style={pathname.startsWith("/map") ? { color: ORANGE } : undefined}>
            Map
          </Link>
          <Link
            href="/organisers/apply"
            className="rounded px-3 py-2 font-medium text-foreground transition-colors hover:bg-surface"
          >
            For organisers
          </Link>
          <AuthNavLinks />
        </nav>
      </div>
    </header>
  );
}
