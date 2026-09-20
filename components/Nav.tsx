import Link from "next/link";
import AuthNavLinks from "@/components/AuthNavLinks";

export default function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="font-heading text-3xl tracking-wide text-foreground">
          Shelt<span style={{ color: "#e15b27" }}>ü</span>h
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-2 text-sm sm:gap-4">
          <Link
            href="/"
            className="rounded px-3 py-2 font-medium text-foreground transition-colors hover:bg-surface"
          >
            Discover
          </Link>
          <Link
            href="/organisers/apply"
            className="rounded px-3 py-2 font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "#e15b27" }}
          >
            Become an organiser
          </Link>
          <AuthNavLinks />
        </nav>
      </div>
    </header>
  );
}
