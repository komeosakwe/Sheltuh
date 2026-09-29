import Link from "next/link";
import { isApiConfigured } from "@/lib/api/client";

export default function Footer() {
  return (
    <footer className="mt-20 bg-foreground text-background">
      <div className="mx-auto max-w-6xl px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
        <p className="display-xl leading-[0.8]">
          Sheltüh
        </p>
        <div className="mt-14 grid grid-cols-2 gap-8 text-sm sm:grid-cols-4">
          <div className="col-span-2 max-w-xs text-background/70">
            {isApiConfigured ? (
              <p>
                Curated creative events in Melbourne. Questions?{" "}
                <a
                  href="mailto:support@sheltuh.com.au"
                  className="text-background underline underline-offset-4"
                >
                  support@sheltuh.com.au
                </a>
              </p>
            ) : (
              <p>
                A local prototype. Sample events only — nothing here is a real booking.
              </p>
            )}
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2">
            <p className="eyebrow text-background/50">Explore</p>
            <Link href="/">Discover</Link>
            <Link href="/map">Map</Link>
          </nav>
          <nav aria-label="Organisers" className="flex flex-col gap-2">
            <p className="eyebrow text-background/50">Organisers</p>
            <Link href="/organisers/apply">Apply</Link>
            <Link href="/dashboard">My events</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
