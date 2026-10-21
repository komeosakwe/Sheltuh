import Link from "next/link";
import type { ReactNode } from "react";

/** "← Back" above a page header: mono, underlined, 44px tall to tap. */
export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="eyebrow inline-flex min-h-11 w-fit items-center gap-1 self-start underline underline-offset-4"
    >
      <span aria-hidden="true">&larr;</span> {children}
    </Link>
  );
}
