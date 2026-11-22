import {
  BEFORE_YOU_GO_SUGGESTED_LABELS,
  validateBeforeYouGo,
  type BeforeYouGoItem,
  type BeforeYouGoPart,
  type BeforeYouGoRowError,
} from "@/lib/before-you-go";

/**
 * The editor's "Before you go" rows as typed (components/dashboard/editor/BeforeYouGoFields.tsx): each a
 * label and a value, with a stable id for React. Checked raw (validateBeforeYouGo numbers them as on
 * screen, blank ones included), and sent raw too, so the API's own "Row N" is the row on screen (it
 * cleans them and drops the blank ones; null is sent when every row is blank). Pure but for the row ids
 * (a counter).
 */
export interface BeforeYouGoRow extends BeforeYouGoItem {
  id: string;
}

/** The errors shown by each row's inputs, at the rows' indexes (null: none). */
export type BeforeYouGoRowErrors = readonly (BeforeYouGoRowError | null)[];

/** The id of a row's input (label or value): what the error summary and a refused save focus. */
export function beforeYouGoInputId(index: number, part: BeforeYouGoPart): string {
  return `beforeYouGo-${index}-${part}`;
}

/** "Add a row": what focus goes to when there are no rows. */
export const BEFORE_YOU_GO_ADD_ID = "beforeYouGo-add";

let lastRowId = 0;

/**
 * A new row's id: React's key only, never sent or shown, so a counter does (crypto.randomUUID is missing
 * outside a secure context, a plain-HTTP dev server included, and the editor must still open there).
 */
function newRowId(): string {
  lastRowId += 1;
  return `before-you-go-row-${lastRowId}`;
}

/** An empty row, for "Add a row". */
export function emptyBeforeYouGoRow(): BeforeYouGoRow {
  return { id: newRowId(), label: "", value: "" };
}

/** The saved rows, or, with none, one empty row per suggested label (Entry, Age, Extras). */
export function initialBeforeYouGoRows(saved: readonly BeforeYouGoItem[] | null | undefined): BeforeYouGoRow[] {
  if (saved && saved.length > 0) return saved.map((item) => ({ id: newRowId(), label: item.label, value: item.value }));
  return BEFORE_YOU_GO_SUGGESTED_LABELS.map(() => emptyBeforeYouGoRow());
}

/** The rows as the API's items (no ids). */
export function beforeYouGoItems(rows: readonly BeforeYouGoRow[]): BeforeYouGoItem[] {
  return rows.map(({ label, value }) => ({ label, value }));
}

/** The first input with an error, in screen order (a row's label before its value), or null. */
export function firstBeforeYouGoError(errors: BeforeYouGoRowErrors): { index: number; part: BeforeYouGoPart; message: string } | null {
  for (let index = 0; index < errors.length; index++) {
    const row = errors[index];
    if (row?.label) return { index, part: "label", message: row.label };
    if (row?.value) return { index, part: "value", message: row.value };
  }
  return null;
}

/** The errors once one input was edited: its own is gone (the others stay until the next save). */
export function withoutBeforeYouGoError(errors: BeforeYouGoRowErrors, index: number, part: BeforeYouGoPart): BeforeYouGoRowErrors {
  const row = errors[index];
  if (!row?.[part]) return errors;
  const rest: BeforeYouGoRowError = { ...row };
  delete rest[part];
  return errors.map((current, i) => (i === index ? (rest.label || rest.value ? rest : null) : current));
}

/**
 * The errors once row `removed` is gone: the inputs that showed one are checked again where they now sit,
 * so "Row 3" becomes "Row 2" in the message; an input that showed none still shows none.
 */
export function beforeYouGoErrorsAfterRemove(
  errors: BeforeYouGoRowErrors,
  rows: readonly BeforeYouGoRow[],
  removed: number,
): BeforeYouGoRowErrors {
  const shown = errors.filter((_, i) => i !== removed);
  if (!shown.some((row) => row?.label || row?.value)) return [];
  const fresh = validateBeforeYouGo(beforeYouGoItems(rows))?.rows ?? [];
  return shown.map((before, i) => {
    const now = fresh[i];
    const kept: BeforeYouGoRowError = {};
    if (before?.label && now?.label) kept.label = now.label;
    if (before?.value && now?.value) kept.value = now.value;
    return kept.label || kept.value ? kept : null;
  });
}
