import { EDITOR_STEPS, type EditorStep } from "./draft";

export interface ErrorSummaryItem {
  key: string;
  step: EditorStep;
  /** "Title", "Ticket 2 price". */
  field: string;
  message: string;
  /** Switches to the field's step and focuses it; none for an error the form has no control for (shown as text). */
  jump?: () => void;
}

/**
 * After a failed save (docs/design/event-editor.md §5.9): every field that needs fixing, grouped by step,
 * each a link that jumps to it. Not an alert and it takes no focus: the save has already focused the
 * first field and said "Not saved: N fields need fixing" in the status line, so a second announcement
 * would be noise. Gone as the errors are cleared by editing.
 */
export default function ErrorSummary({ items }: { items: readonly ErrorSummaryItem[] }) {
  if (items.length === 0) return null;
  const groups = EDITOR_STEPS.map(({ step, label }) => ({ step, label, items: items.filter((item) => item.step === step) })).filter(
    (group) => group.items.length > 0,
  );
  return (
    <section
      aria-labelledby="error-summary-title"
      data-error-summary=""
      className="border-l-2 border-danger py-1 pl-4 text-sm text-foreground"
    >
      <h3 id="error-summary-title" className="font-semibold">
        {items.length === 1 ? "1 field needs fixing" : `${items.length} fields need fixing`}
      </h3>
      <div className="mt-2 flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.step}>
            <p className="font-medium">{group.label}</p>
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li key={item.key}>
                  {item.jump ? (
                    <button
                      type="button"
                      onClick={item.jump}
                      className="inline-flex min-h-11 items-center text-left underline underline-offset-4 sm:min-h-6"
                    >
                      {item.field}: {item.message}
                    </button>
                  ) : (
                    <span className="inline-flex min-h-6 items-center">
                      {item.field}: {item.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
