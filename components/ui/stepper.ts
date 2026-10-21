/**
 * A quantity stepper's − and + buttons (brand-direction-one.md §6.9). They
 * use aria-disabled, not `disabled`: reaching 0 or the cap must leave focus
 * on the button rather than dropping it to <body>.
 */
export const stepperButtonClass =
  "flex size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card text-lg font-semibold text-foreground transition-colors hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card";
