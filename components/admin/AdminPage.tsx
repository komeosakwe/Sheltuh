import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/Section";

export interface Crumb {
  label: string;
  /** Absent for the current page (the last crumb). */
  href?: string;
}

/**
 * Where an admin page sits: "Admin / Events / Edit event". A
 * named nav landmark with an ordered list; the current page is the last item,
 * marked aria-current. The slashes are decorative.
 */
export function AdminBreadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 text-sm leading-5">
        {trail.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-x-2">
            {index > 0 && (
              <span aria-hidden="true" className="text-muted">
                /
              </span>
            )}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:decoration-2"
              >
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 items-center text-muted">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const WIDTH_CLASS = { narrow: "max-w-2xl", medium: "max-w-3xl", wide: "" } as const;

/**
 * An admin sub-page (inside app/admin/layout.tsx, which gates it and adds the
 * sub-nav): breadcrumbs, the h1, one line on what the page is for, then the
 * page's content.
 */
export default function AdminPage({
  crumbs,
  title,
  intro,
  width = "medium",
  children,
}: {
  /** The trail above the current page; "Admin" first. The current page is added from `title`. */
  crumbs: Crumb[];
  title: string;
  /** One or two sentences: what this page is for and what its actions do. */
  intro: ReactNode;
  width?: keyof typeof WIDTH_CLASS;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className={`flex flex-col gap-6 ${WIDTH_CLASS[width]}`.trim()}>
        <AdminBreadcrumbs trail={[...crumbs, { label: title }]} />
        <PageHeader flush size="md" eyebrow="Admin" title={title} intro={intro} />
        {children}
      </div>
    </div>
  );
}
