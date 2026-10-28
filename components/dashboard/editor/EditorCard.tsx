import type { ComponentProps, ReactNode } from "react";

/** A section card of the event editor (docs/design/event-editor.md §5.4): a 1px foreground border, no shadow, always open. */
const CARD = "rounded-card border border-foreground bg-card p-4 sm:p-5 flex flex-col gap-4";

/**
 * One decision per card. With a `title` it names itself (an h3 and an optional helper line, and `action` on
 * the right of the header from sm). `titled={false}` is the chrome only, for children that already render
 * their own fieldset and legend (seating, refunds, where tickets are sold): the legend is the title.
 * Extra props (id, tabIndex, role, aria-*) go on the section, as the venue card's focus target needs.
 */
export default function EditorCard({
  title,
  titleId,
  helper,
  action,
  titled = true,
  className = "",
  children,
  ...rest
}: {
  title?: string;
  /** The h3's id (the section is labelled by it). */
  titleId?: string;
  helper?: ReactNode;
  action?: ReactNode;
  titled?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "title" | "children" | "className">) {
  if (!titled || !title) {
    return (
      <section className={`${CARD} ${className}`.trim()} {...rest}>
        {children}
      </section>
    );
  }
  const headingId = titleId ?? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className={`${CARD} ${className}`.trim()} {...rest}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={headingId} className="font-heading text-lg leading-6 text-foreground">
            {title}
          </h3>
          {helper && <p className="max-w-prose text-sm leading-5 text-muted">{helper}</p>}
        </div>
        {action}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}
