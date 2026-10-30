import type { ReactNode, Ref } from "react";
import DotsMark from "@/components/brand/DotsMark";
import Strap from "./Strap";

/**
 * The site's one page container: centred, with the same responsive gutters as the header and
 * footer (20px, 32px from 640px) and the same vertical rhythm, so every page lines up under the
 * logo and nothing hugs one side of a wide screen.
 *
 * - `wide` (default): the 1152px page column (feeds, dashboards, event pages).
 * - `narrow`: a centred 672px reading column (About, Help, legal, profile).
 * - `form`: a centred 448px column that stacks its children with a gap (sign in, sign up,
 *   verify, reset password).
 * - `full`: only the gutters, for a page that sets its own `max-w-*` through `className`.
 */
export function Page({
  children,
  width = "wide",
  padding = "default",
  className = "",
}: {
  children: ReactNode;
  width?: "wide" | "narrow" | "form" | "full";
  /** `subNav`: less space above and below, for a page under a section sub-nav (the organiser area's). */
  padding?: "default" | "subNav";
  className?: string;
}) {
  const max = width === "full" ? "" : "max-w-6xl";
  const py = padding === "subNav" ? "py-8 sm:py-12" : "py-12 sm:py-20";
  const inner =
    width === "narrow"
      ? "mx-auto w-full max-w-2xl"
      : width === "form"
        ? "mx-auto flex w-full max-w-md flex-col gap-8"
        : null;
  return (
    <div className={`mx-auto w-full px-5 sm:px-8 ${py} ${max} ${className}`.trim()}>
      {inner ? <div className={inner}>{children}</div> : children}
    </div>
  );
}

/**
 * A page's header (docs/design/brand-direction-one.md §6.4): a mono strap
 * with the two dots (no top rule: the header's rule is just above it), the
 * h1, then an optional intro, with an action on the right from 640px.
 *
 * `size="md"` is the quieter tool header (account, dashboard, admin). `brand`
 * is for the brand lines only ("What's on.", "Sheltüh near you."): at most one
 * per page, plain Instrument Sans with a letter or two in the dotted face
 * (pass the title through `DottedLine`; owner, 30 Oct 2026: never whole sentences). The h1 never animates in (it's
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
  titleDescribedBy,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  size?: "lg" | "md";
  brand?: boolean;
  flush?: boolean;
  titleId?: string;
  /**
   * Makes the h1 focusable (tabIndex -1) so script can move focus to it. It's
   * not a control, so it shows no focus ring (`!`: the global :focus-visible
   * ring in globals.css is unlayered, so it beats any utility otherwise).
   */
  titleRef?: Ref<HTMLHeadingElement>;
  /** The h1's aria-describedby: the id(s) of what explains it, read when focus moves to it. */
  titleDescribedBy?: string;
}) {
  const titleClass = size === "md" ? "display-md" : brand ? "display-lg font-display display-plain" : "display-lg";
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
          aria-describedby={titleDescribedBy}
          className={`${titleClass} break-words outline-offset-2 ${titleRef ? "focus:outline-none!" : ""}`.trim()}
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
