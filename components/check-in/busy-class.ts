/**
 * Busy pills on the door. The shared `.btn[aria-disabled]` style dims the
 * whole pill to 50% opacity, which drops its text below 4.5:1 on ink. Here a
 * busy pill gets solid colours instead: muted text on surface (6.5:1).
 * Utilities win over the `components` layer, so this overrides it.
 */
export const doorBusyClass =
  "aria-disabled:border-surface-border aria-disabled:bg-surface aria-disabled:text-muted aria-disabled:opacity-100";
