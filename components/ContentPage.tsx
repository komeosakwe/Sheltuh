import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/Section";

/**
 * Shared layout for the static information pages (About, Help, legal…):
 * an editorial header and a readable single column of text.
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
          <span className="eyebrow bg-highlight px-2 py-1 text-foreground">Draft</span>
          <span className="text-muted">
            This page is a plain-language draft and has not yet been reviewed by a lawyer. It may
            change before launch.
          </span>
        </p>
      )}
      <div className="flex flex-col gap-10 text-base leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-3xl [&_h2]:mb-3 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </Page>
  );
}

/** One titled block on a content page. */
export function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-foreground pt-6">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
