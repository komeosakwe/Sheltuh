import { EDITOR_STEPS, type EditorStep } from "./draft";

function CheckGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

/**
 * The editor's steps (docs/design/event-editor.md §5.3): one nav, a row of three on phones and a column
 * (the rail, under the summary) from lg. Buttons, not tabs: they only decide which cards show. The
 * current one is `aria-current="step"`; a complete step has a check, a step with errors a count. Each
 * state is also a word for screen readers (and bold / a numeral / a glyph for sighted people), never
 * colour alone. Steps are never disabled.
 */
export default function StepNav({
  current,
  onSelect,
  complete,
  errorCounts,
  admin,
}: {
  current: EditorStep;
  onSelect: (step: EditorStep) => void;
  /** Steps 1 and 2 only: nothing in them needs fixing (a marker, never a gate). */
  complete: { 1: boolean; 2: boolean };
  /** Fields needing fixing per step, after a failed save. */
  errorCounts: Record<EditorStep, number>;
  admin: boolean;
}) {
  return (
    <nav aria-label="Event steps">
      <ol className="grid grid-cols-3 gap-2 lg:flex lg:flex-col lg:gap-1">
        {EDITOR_STEPS.map(({ step, label, description }) => {
          const isCurrent = step === current;
          const errors = errorCounts[step];
          const done = step !== 3 && complete[step] && errors === 0;
          const text = step === 3 && admin ? "Check it and publish" : description;
          const state = isCurrent ? ", current step" : done ? ", complete" : "";
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                aria-describedby={`step-${step}-description`}
                data-step={step}
                onClick={() => onSelect(step)}
                className={`flex min-h-14 w-full flex-col items-start gap-1 border-t-2 pt-2 text-left lg:flex-row lg:items-start lg:gap-3 lg:rounded-control lg:border-t-0 lg:px-2 lg:py-2 lg:hover:bg-surface ${
                  isCurrent ? "border-foreground" : "border-surface-border"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`meta flex size-7 shrink-0 items-center justify-center rounded-control border border-foreground ${
                      isCurrent ? "bg-foreground text-background" : "bg-card text-foreground"
                    }`}
                  >
                    {done && !isCurrent ? <CheckGlyph /> : step}
                  </span>
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-sm leading-5 ${isCurrent ? "font-bold" : "font-semibold"}`}>
                      {label}
                      <span className="sr-only">
                        {state}
                        {errors > 0 && `, ${errors} ${errors === 1 ? "field needs" : "fields need"} fixing`}
                      </span>
                    </span>
                    {errors > 0 && (
                      <span
                        aria-hidden="true"
                        data-step-errors={errors}
                        className="eyebrow inline-flex rounded-badge border border-danger px-1.5 text-danger"
                      >
                        {errors}
                      </span>
                    )}
                  </span>
                  <span id={`step-${step}-description`} aria-hidden="true" className="hidden text-xs leading-4 text-muted sm:block">
                    {text}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
