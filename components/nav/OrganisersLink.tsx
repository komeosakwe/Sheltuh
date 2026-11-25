"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useOptionalNavAccount } from "@/components/nav/useNavAccount";
import { ORGANISERS_HREF } from "@/lib/organiser-nav";

/**
 * A "For organisers" link outside the header (the footer's): where the header's goes, the
 * dashboard for an approved organiser (NavAccount's organisersHref), else the For organisers page.
 * Rendered on the server (and without the root layout's NavAccountProvider) as the For organisers
 * page, which is what every signed-out visitor gets.
 */
export default function OrganisersLink({ className, children }: { className?: string; children: ReactNode }) {
  const href = useOptionalNavAccount()?.organisersHref ?? ORGANISERS_HREF;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
