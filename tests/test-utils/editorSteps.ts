import { fireEvent, screen, within } from "@testing-library/react";

const STEP_NAME = { 1: /^Event page/, 2: /^Tickets/, 3: /^Publish/ } as const;

/**
 * Shows one of the event editor's steps (Event page, Tickets, Publish) by its button in the step nav, as a
 * person does. All three panels stay mounted but the others are `hidden`, so a test that finds a control by
 * its role needs the step it is on showing first (finding it by label or text needs no step).
 */
export function showStep(step: 1 | 2 | 3): void {
  const nav = screen.getByRole("navigation", { name: "Event steps" });
  fireEvent.click(within(nav).getByRole("button", { name: STEP_NAME[step] }));
}

/** The step the editor is on (1 Event page, 2 Tickets, 3 Publish): the step nav's current button. */
export function currentStep(): number {
  const nav = screen.getByRole("navigation", { name: "Event steps" });
  const current = nav.querySelector<HTMLElement>("[aria-current='step']");
  return Number(current?.dataset.step ?? 0);
}
