import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/Section";

/**
 * Shared layout for the static information pages (About, Help, legal…):
 * an editorial header and a readable single column of text
 * (docs/design/brand-direction-one.md §7): black-ruled sections with
 * display-md heads, the brand's square bullets, black underlined links, and
 * the orange Draft label on legal text not yet reviewed.
 */
export default function ContentPage({
  eyebrow,
  title,
  intro,
  draft = false,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  /** Marks legal/policy text that has not yet had a legal review. */
  draft?: boolean;
  children: ReactNode;
}) {
  return (
    <Page width="narrow">
      <PageHeader eyebrow={eyebrow} title={title} intro={intro} />
      {draft && (
        <p role="note" className="mb-10 flex flex-wrap items-baseline gap-3 text-sm">
          <span className="eyebrow rounded-badge bg-signal px-2 py-1 text-signal-foreground">Draft</span>
          <span className="text-muted">
            This page is a plain-language draft and has not yet been reviewed by a lawyer. It may
            change before launch.
          </span>
        </p>
      )}
      <div className="square-bullets flex flex-col gap-10 text-base leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_p+p]:mt-3">
        {children}
      </div>
    </Page>
  );
}

/** One titled block on a content page. `id` makes it a link target (e.g. /privacy#whos-going). */
export function ContentSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-foreground pt-6">
      <h2 className="display-md">{title}</h2>
      {children}
    </section>
  );
}
