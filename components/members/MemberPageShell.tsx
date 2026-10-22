import type { ReactNode } from "react";
import BackLink from "@/components/ui/BackLink";

/** A member profile page's frame (live and demo): back to all events, then the page. */
export default function MemberPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-2 pb-12 sm:gap-10 sm:px-8 sm:py-14">
      <BackLink href="/events">All events</BackLink>
      {children}
    </div>
  );
}
