"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthNavLinks, { navLinkClass } from "@/components/AuthNavLinks";
import SearchBar from "@/components/SearchBar";
import { ButtonLink } from "@/components/ui/Button";

export default function Nav() {
  const pathname = usePathname();

  function linkClassName(href: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return `${navLinkClass} ${active ? "underline decoration-2 underline-offset-8" : ""}`;
  }

  return (
    <header className="sticky top-0 z-20 bg-background/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Sheltüh home" className="font-heading text-4xl leading-none">
          Shelt<span aria-hidden="true">ü</span>h
        </Link>
        {/* Search sits beside the logo on wide screens, on its own row on phones. */}
        <div className="order-last w-full lg:order-none lg:max-w-sm lg:flex-1">
          <SearchBar />
        </div>
        <nav aria-label="Primary" className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-3">
          <Link href="/" className={linkClassName("/")}>
            Discover
          </Link>
          <Link href="/map" className={linkClassName("/map")}>
            Map
          </Link>
          <AuthNavLinks />
          <ButtonLink href="/organisers/apply" size="sm" className="ml-1">
            For organisers
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
