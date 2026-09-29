import type { ReactNode } from "react";

/** Standard page container: generous gutters and vertical rhythm. */
export function Page({
  children,
  width = "wide",
  className = "",
}: {
  children: ReactNode;
  width?: "wide" | "narrow" | "full";
  className?: string;
}) {
  const max = width === "narrow" ? "max-w-2xl" : width === "full" ? "" : "max-w-6xl";
  return (
    <div className={`mx-auto w-full px-5 py-12 sm:px-8 sm:py-20 ${max} ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * Editorial page header: small eyebrow, oversized display title, optional
 * intro copy and an action slot (typically a pill CTA) aligned to the right.
 */
export function PageHeader({
  eyebrow,
  title,
  intro,
  action,
  size = "lg",
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <header className="mb-10 flex flex-col gap-6 sm:mb-14 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-3xl flex-col gap-4">
        {eyebrow && <p className="eyebrow text-muted">{eyebrow}</p>}
        <h1 className={size === "lg" ? "display-lg" : "display-md"}>{title}</h1>
        {intro && <div className="max-w-xl text-base leading-relaxed text-muted">{intro}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** Section title row used above carousels and lists: title + intro left, CTA right. */
export function SectionHeader({
  title,
  intro,
  action,
  id,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-xl">
        <h2 id={id} className="display-md">
          {title}
        </h2>
        {intro && <p className="mt-2 text-sm leading-relaxed text-muted sm:mt-3 sm:text-base">{intro}</p>}
      </div>
      {action}
    </div>
  );
}

/** Hairline-ruled panel — replaces rounded "cards" for grouped content. */
export function Panel({
  children,
  className = "",
  title,
  titleId,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  /** Names the section by its title, making it a labelled region landmark. */
  titleId?: string;
}) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={`border-t border-foreground pt-5 ${className}`.trim()}
    >
      {title && (
        <h2 id={titleId} className="display-md mb-4 !text-2xl">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Empty / message state: big type, no dashed rounded box. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-t border-foreground py-12">
      <p className="display-md">{title}</p>
      {children && <div className="mt-3 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Inline notice (errors / info). Flat, ruled on the left, never a rounded box. */
export function Notice({
  children,
  tone = "info",
  role,
}: {
  children: ReactNode;
  tone?: "info" | "danger";
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={`border-l-2 py-1 pl-4 text-sm text-foreground ${
        tone === "danger" ? "border-danger" : "border-foreground"
      }`}
    >
      {children}
    </div>
  );
}
