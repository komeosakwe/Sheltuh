import type { ReactNode, Ref } from "react";
import DotsMark from "@/components/brand/DotsMark";
import Strap from "./Strap";

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
  // Narrow pages keep the site's left edge (in line with the logo): the same outer column as a
  // wide page, with the content left-aligned in a max-w-2xl column inside it.
  const max = width === "full" ? "" : "max-w-6xl";
  return (
    <div className={`mx-auto w-full px-5 py-12 sm:px-8 sm:py-20 ${max} ${className}`.trim()}>
      {width === "narrow" ? <div className="max-w-2xl">{children}</div> : children}
    </div>
  );
}

/**
 * A page's header (docs/design/brand-direction-one.md §6.4): a mono strap
 * with the two dots (no top rule: the header's rule is just above it), the
 * h1, then an optional intro, with an action on the right from 640px.
 *
 * `size="md"` is the quieter tool header (account, dashboard, admin). `brand`
 * sets the h1 in the display face, for the brand lines only ("What's on.",
 * "Sheltüh near ü."): at most one per page. The h1 never animates in (it's
 * the LCP element); the strap, intro and action rise in on load.
 * `flush` drops the bottom margin, for a parent that spaces its own children.
 */
export function PageHeader({
  eyebrow,
  title,
  intro,
  action,
  size = "lg",
  brand = false,
  flush = false,
  titleId,
  titleRef,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  size?: "lg" | "md";
  brand?: boolean;
  flush?: boolean;
  titleId?: string;
  /** Makes the h1 focusable (tabIndex -1) so focus can be moved to it. */
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  const titleClass = size === "md" ? "display-md" : brand ? "display-lg font-display" : "display-lg";
  return (
    <header
      className={`flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between ${flush ? "" : "mb-10 sm:mb-14"}`.trim()}
    >
      <div className="flex min-w-0 max-w-3xl flex-col">
        {eyebrow && <Strap label={eyebrow} rule={false} className="rise mb-4" />}
        <h1
          id={titleId}
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className={`${titleClass} break-words outline-offset-2`}
        >
          {title}
        </h1>
        {intro && (
          <div className="rise mt-4 max-w-xl text-base leading-6 text-pretty text-muted [--d:80ms] sm:text-lg sm:leading-7">
            {intro}
          </div>
        )}
      </div>
      {action && <div className="rise shrink-0 [--d:120ms]">{action}</div>}
    </header>
  );
}

/** A black-ruled section (§6.4): grouped content on the page, never a rounded box. */
export function Panel({
  children,
  className = "",
  title,
  titleId,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  /** Names the section by its title, making it a labelled region landmark. */
  titleId?: string;
}) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={`border-t border-foreground pt-5 ${className}`.trim()}
    >
      {title && (
        <h2 id={titleId} className="font-heading mb-4 text-xl leading-6">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/**
 * Empty / message state (§6.14): a black rule, the two dots, a big title, a
 * short line and an optional action. `mark={false}` drops the dots (where
 * the state isn't a pause, e.g. a refusal).
 */
export function EmptyState({
  title,
  children,
  action,
  headingLevel,
  titleRef,
  mark = true,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Make the title a heading (a page whose main state this is needs its h1). Default: a paragraph. */
  headingLevel?: 1 | 2;
  /** With `headingLevel`: the heading, focusable (tabIndex -1) so focus can be moved to it. */
  titleRef?: Ref<HTMLHeadingElement>;
  mark?: boolean;
}) {
  const Title = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : null;
  return (
    <div className="border-t border-foreground py-12">
      {mark && <DotsMark size="lg" className="mb-6 text-foreground" />}
      {Title ? (
        <Title ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="display-md outline-offset-2">
          {title}
        </Title>
      ) : (
        <p className="display-md">{title}</p>
      )}
      {children && <div className="mt-3 max-w-md text-sm leading-5 text-muted">{children}</div>}
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
