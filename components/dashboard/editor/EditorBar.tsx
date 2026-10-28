import type { Ref } from "react";
import { Button } from "@/components/ui/Button";
import { EDITOR_STEPS, type EditorStep } from "./draft";

/**
 * The sticky save bar (docs/design/event-editor.md §5.8), the last child of the editor's shell so it settles
 * under the content at the page's end. No shadow: the top border is the elevation. Save is `busy`, never
 * `disabled`, so it keeps focus while it works. Next and Back only move between steps: they save nothing.
 */
export default function EditorBar({
  step,
  onStep,
  saveRef,
  saving,
  saveLabel,
  lastSaved,
}: {
  step: EditorStep;
  onStep: (step: EditorStep) => void;
  saveRef: Ref<HTMLButtonElement>;
  saving: boolean;
  /** The save button's words (EventEditor's saveLabel). */
  saveLabel: string;
  /** "2:14 pm", none for a new event. */
  lastSaved?: string;
}) {
  const next = step < 3 ? EDITOR_STEPS[step] : null;
  const back = step > 1 ? EDITOR_STEPS[step - 2] : null;
  return (
    <div
      data-edit-bar=""
      className="sticky bottom-0 z-20 -mx-5 border-t border-foreground bg-background sm:-mx-8"
    >
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-5 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-8">
        <p className="meta hidden text-muted sm:block">{lastSaved ? `Last saved ${lastSaved}` : "Not saved yet"}</p>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
          {/* busy, not disabled: the button keeps focus while it works (a disabled one drops it to the page). */}
          <Button
            ref={saveRef}
            type="submit"
            variant="solid"
            busy={saving}
            className="min-h-11 px-3 text-center whitespace-normal sm:px-5"
          >
            {saving ? "Saving…" : saveLabel}
          </Button>
          {next && (
            <Button
              variant="outline"
              aria-label={`Next: ${next.label}`}
              onClick={() => onStep(next.step)}
              className="min-h-11 px-3 sm:px-5"
            >
              Next
            </Button>
          )}
          {back && (
            <Button
              variant="outline"
              aria-label={`Back: ${back.label}`}
              onClick={() => onStep(back.step)}
              className="min-h-11 px-3 sm:px-5"
            >
              Back
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
