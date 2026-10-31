import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/Section";

/**
 * Shared layout for the static information pages (About, Help, legal…):
 * an editorial header and a readable single column of text
 * (docs/design/brand-direction-one.md §7): black-ruled sections with
 * display-md heads, the brand's square bullets and black underlined links.
 */
export default function ContentPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Page width="narrow">
      <PageHeader eyebrow={eyebrow} title={title} intro={intro} />
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
