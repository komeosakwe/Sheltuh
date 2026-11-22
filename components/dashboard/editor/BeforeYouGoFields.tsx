import { fieldClass } from "@/components/ui/Field";
import {
  BEFORE_YOU_GO_LABEL_MAX_LENGTH,
  BEFORE_YOU_GO_MAX_ITEMS,
  BEFORE_YOU_GO_SUGGESTED_LABELS,
  BEFORE_YOU_GO_TITLE,
  BEFORE_YOU_GO_VALUE_MAX_LENGTH,
  type BeforeYouGoPart,
} from "@/lib/before-you-go";
import {
  BEFORE_YOU_GO_ADD_ID,
  beforeYouGoInputId,
  type BeforeYouGoRow,
  type BeforeYouGoRowErrors,
} from "./before-you-go-rows";

/** Under the group's heading (lib/before-you-go.ts has the limits it gives). */
export const BEFORE_YOU_GO_HINT = `What people should know before they arrive. Up to ${BEFORE_YOU_GO_MAX_ITEMS} short rows. No links.`;
const HINT_ID = "beforeYouGo-hint";
/** The group's own error (the API's fieldErrors.beforeYouGo, or the list's): the first input is described by it. */
export const BEFORE_YOU_GO_GROUP_ERROR_ID = "beforeYouGo-error";

/** The owner's reference rows, as each starter row's placeholder (rows 4 and 5 have none). */
const VALUE_PLACEHOLDERS: readonly string[] = ["7:30 pm – 10:30 pm", "18+ · Photo ID required", "Free earplugs at the bar"];

/** 48px on phones, 44px from 640px (fieldClass is 40 there). */
const INPUT_CLASS = `${fieldClass} min-h-12 sm:min-h-11`;

/**
 * The editor's "Before you go" rows (docs/architecture.md, "Before you go"): a group headed
 * "Before you go (optional)" with its hint, then each row's Label and Value inputs (stacked on phones,
 * side by side from 640px) and its Remove button, then "Add a row" while there are fewer than
 * BEFORE_YOU_GO_MAX_ITEMS. Each input shows its own error (validateBeforeYouGo on the rows as typed, so
 * "Row 2" is the second on screen); the group's error (the API's) shows under the hint. Controlled: the
 * editor owns the rows, the errors and focus.
 */
export default function BeforeYouGoFields({
  rows,
  errors,
  groupError,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: readonly BeforeYouGoRow[];
  errors: BeforeYouGoRowErrors;
  /** Shown under the hint when no input has an error of its own (the API's message, or too many rows). */
  groupError?: string;
  onChange: (index: number, part: BeforeYouGoPart, text: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const describedBy = [HINT_ID, groupError ? BEFORE_YOU_GO_GROUP_ERROR_ID : ""].filter(Boolean).join(" ");

  function input(index: number, part: BeforeYouGoPart, value: string) {
    const id = beforeYouGoInputId(index, part);
    const error = errors[index]?.[part];
    const errorId = `${id}-error`;
    // The API's error has no input of its own: the first input (where focus goes) is described by it.
    const groupDescribed = Boolean(groupError) && index === 0 && part === "label";
    const described = [error ? errorId : "", groupDescribed ? BEFORE_YOU_GO_GROUP_ERROR_ID : ""].filter(Boolean).join(" ");
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${part === "value" ? "sm:col-span-2" : ""}`.trim()}>
        <label htmlFor={id} className="eyebrow text-muted">
          {part === "label" ? "Label" : "Value"}
        </label>
        <input
          id={id}
          type="text"
          value={value}
          maxLength={part === "label" ? BEFORE_YOU_GO_LABEL_MAX_LENGTH : BEFORE_YOU_GO_VALUE_MAX_LENGTH}
          placeholder={part === "label" ? BEFORE_YOU_GO_SUGGESTED_LABELS[index] : VALUE_PLACEHOLDERS[index]}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          onChange={(e) => onChange(index, part, e.target.value)}
          className={INPUT_CLASS}
        />
        {error && (
          <p id={errorId} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <fieldset aria-describedby={describedBy} data-before-you-go-fields="" className="flex min-w-0 flex-col gap-4">
      <legend className="eyebrow mb-1 text-muted">{BEFORE_YOU_GO_TITLE} (optional)</legend>
      <div className="flex flex-col gap-1">
        <p id={HINT_ID} className="text-xs leading-4 text-muted">
          {BEFORE_YOU_GO_HINT}
        </p>
        {groupError && (
          <p id={BEFORE_YOU_GO_GROUP_ERROR_ID} className="text-sm text-danger">
            {groupError}
          </p>
        )}
      </div>
      {rows.map((row, index) => (
        <div
          key={row.id}
          role="group"
          aria-labelledby={`beforeYouGo-${index}-title`}
          data-before-you-go-row=""
          className="flex min-w-0 flex-col gap-2 border-t border-surface-border pt-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p id={`beforeYouGo-${index}-title`} className="eyebrow text-muted">
              Row {index + 1}
            </p>
            <button
              type="button"
              onClick={() => onRemove(index)}
              // Its visible word starts its name (WCAG 2.5.3), the row says which.
              aria-label={`Remove row ${index + 1}`}
              className="inline-flex min-h-11 items-center text-sm text-danger underline underline-offset-2"
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {input(index, "label", row.label)}
            {input(index, "value", row.value)}
          </div>
        </div>
      ))}
      {rows.length < BEFORE_YOU_GO_MAX_ITEMS && (
        <div>
          <button id={BEFORE_YOU_GO_ADD_ID} type="button" onClick={onAdd} className="btn btn-outline min-h-11">
            Add a row
          </button>
        </div>
      )}
    </fieldset>
  );
}
