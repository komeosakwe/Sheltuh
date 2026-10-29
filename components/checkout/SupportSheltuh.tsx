"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { formatAud } from "@/lib/format";
import { NO_SUPPORT, supportErrorOf, type SupportChoice } from "@/lib/support-choice";
import {
  SUPPORT_LABEL,
  SUPPORT_MAX_CENTS,
  SUPPORT_MIN_CENTS,
  SUPPORT_OPTIONAL,
  SUPPORT_PRESETS_CENTS,
  SUPPORT_RECIPIENT_NOTE,
} from "@/lib/support";
import { CheckIcon } from "./icons";

interface SupportSheltuhProps {
  /** Controlled: the parent keeps it, adds it to the total and sends it with the checkout. */
  choice: SupportChoice;
  onChange: (next: SupportChoice) => void;
  /** Show an "Other" amount's error now, not only once the field is left (set when Checkout finds it invalid). */
  revealError?: boolean;
  /** The API's refusal (400 `fieldErrors.supportCents`), said here by the chips. */
  serverError?: string | null;
  /** The Other amount field, so the parent can focus it when Checkout finds it invalid. */
  otherInputRef?: RefObject<HTMLInputElement | null>;
}

type OptionKey = number | "other";

function keyOf(choice: SupportChoice): OptionKey | null {
  if (choice.option === "preset") return choice.cents;
  if (choice.option === "other") return "other";
  return null;
}

/**
 * Support Sheltüh at checkout (lib/support.ts; docs/architecture.md, "Support
 * Sheltüh"): one-tap amounts (A$2, A$5, A$10) and Other, right above
 * Checkout, for paid orders only (the parent leaves it out otherwise).
 *
 * "(optional)" is in the legend, and who gets it (Sheltüh, not the
 * organiser) is said before the amounts.
 *
 * A radio group of native radios drawn as chips (each radio transparent over
 * its chip): Tab reaches it, the arrow keys move through it, and its state is
 * announced. Nothing is pre-selected (ACCC). Tapping the chosen chip again
 * removes it (Space on it does the same), and a Remove button says so plainly
 * for everyone else. The selected chip is Signal Orange with black text and a
 * check, never colour alone. Other opens an A$ field, checked with
 * isValidSupportCents's limits (via lib/support-choice.ts): its error shows
 * once the field is left, or when Checkout is pressed, in the hint's place
 * (one slot two lines tall), so nothing below it moves: leaving the field by
 * pressing Checkout must not move Checkout from under the press.
 */
export default function SupportSheltuh({ choice, onChange, revealError = false, serverError, otherInputRef }: SupportSheltuhProps) {
  const id = useId();
  const name = `${id}-support`;
  const noteId = `${id}-note`;
  const serverErrorId = `${id}-server-error`;
  const otherId = `${id}-other`;
  const otherHintId = `${id}-other-hint`;
  const otherErrorId = `${id}-other-error`;

  const localOtherRef = useRef<HTMLInputElement>(null);
  const otherRef = otherInputRef ?? localOtherRef;
  const firstRadioRef = useRef<HTMLInputElement>(null);
  // Other chosen with a tap or click (not the arrow keys, which would leave the group): focus its field once shown.
  const focusOther = useRef(false);
  // A pointer went down on a chip, so the change that follows is a tap or click. (The arrow keys
  // click the radio too, with no pointer, so the click itself can't tell them apart.)
  const pointerChoosing = useRef(false);
  // The Other field has been left at least once since it opened: its error can show.
  const [otherLeft, setOtherLeft] = useState(false);

  const selected = keyOf(choice);
  const otherError = supportErrorOf(choice);
  const shownOtherError = otherError && (otherLeft || revealError) ? otherError : null;

  useEffect(() => {
    if (choice.option === "other" && focusOther.current) {
      focusOther.current = false;
      otherRef.current?.focus();
    }
  }, [choice.option, otherRef]);

  function select(key: OptionKey, pointer: boolean) {
    setOtherLeft(false);
    if (key === "other") {
      focusOther.current = pointer;
      onChange({ option: "other", text: "" });
    } else {
      onChange({ option: "preset", cents: key });
    }
  }

  // A click on the chip that's already chosen (a tap) removes it, as Space on it does (onKeyDown).
  // Choosing another is the radio's change event, which the arrow keys fire too.
  function onRadioClick(key: OptionKey) {
    if (key === selected) {
      setOtherLeft(false);
      onChange(NO_SUPPORT);
    }
  }

  function remove() {
    setOtherLeft(false);
    onChange(NO_SUPPORT);
    // The button goes with the choice: focus stays in the group rather than dropping to the page.
    firstRadioRef.current?.focus();
  }

  const options: { key: OptionKey; label: string }[] = [
    ...SUPPORT_PRESETS_CENTS.map((cents) => ({ key: cents, label: formatAud(cents) })),
    { key: "other", label: "Other" },
  ];

  return (
    <fieldset
      aria-describedby={[noteId, serverError ? serverErrorId : null].filter(Boolean).join(" ")}
      // Not itself a flex box: Chromium laid the chips' size container out at zero size inside a flex
      // fieldset after a change (A$5, then Other). The div below does the layout.
      className="min-w-0"
      data-support-sheltuh=""
    >
      {/* "(optional)" is part of the group's name, before any amount. */}
      <legend className="text-base leading-6 font-semibold text-foreground">
        {SUPPORT_LABEL} <span className="font-normal text-muted">{SUPPORT_OPTIONAL}</span>
      </legend>
      <div className="flex flex-col gap-3">
        {/* Who gets it, before the amounts, in the body text's size. */}
        <p id={noteId} className="text-sm text-foreground">
          {SUPPORT_RECIPIENT_NOTE}
        </p>

        {/* Two by two in a narrow panel (phones up to about 400px), one row of four from 20rem of
            room, where even "✓ A$10" fits its chip. One column below 10rem (large text on a phone:
            the sizes are in rem, so the steps follow the text size), and a label that still
            doesn't fit wraps rather than spilling out of its chip. */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-2 @min-[10rem]:grid-cols-2 @xs:grid-cols-4">
            {options.map((option, index) => {
              const checked = option.key === selected;
              return (
                <label
                  key={option.key}
                  className="relative block min-w-0"
                  onPointerDown={() => {
                    pointerChoosing.current = true;
                  }}
                >
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name={name}
                    value={String(option.key)}
                    checked={checked}
                    onChange={() => {
                      select(option.key, pointerChoosing.current);
                      pointerChoosing.current = false;
                    }}
                    onClick={() => onRadioClick(option.key)}
                    // Space on the chosen chip removes it too. Browsers don't click a radio that's
                    // already checked on Space (Chromium sends no click), so it's done here, and the
                    // key's own action is stopped so no browser clicks it back on.
                    onKeyDown={(event) => {
                      pointerChoosing.current = false;
                      if (checked && event.key === " ") {
                        event.preventDefault();
                        onRadioClick(option.key);
                      }
                    }}
                    // The real radio, transparent, over the whole chip: a press lands on it (and focuses
                    // it) rather than on the label, whose press would move focus out to the page first
                    // (closing the seat page's phone sheet, which closes when focus leaves it).
                    className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0"
                  />
                  <span className="flex min-h-12 w-full cursor-pointer flex-wrap items-center justify-center gap-x-1.5 rounded-control border border-foreground bg-card px-1 py-1 text-center text-base leading-6 font-semibold break-words tabular-nums text-foreground peer-hover:bg-surface peer-checked:bg-signal peer-checked:text-signal-foreground peer-checked:peer-hover:bg-signal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground motion-safe:transition-colors">
                    {checked && <CheckIcon />}
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {choice.option === "other" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={otherId} className="eyebrow text-muted">
              Other amount
            </label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted">
                A$
              </span>
              <input
                ref={otherRef}
                id={otherId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={choice.text}
                onChange={(event) => onChange({ option: "other", text: event.target.value })}
                onBlur={() => setOtherLeft(true)}
                aria-invalid={shownOtherError ? true : undefined}
                // Whichever of the hint and the error is showing (never both).
                aria-describedby={shownOtherError ? otherErrorId : otherHintId}
                // 16px text so iOS doesn't zoom on focus, and a 48px target (as the email field).
                className="min-h-12 w-full py-2 pr-3 pl-10 text-base tabular-nums"
              />
            </div>
            {/* One slot, two lines of the error's text tall, for the hint or the error (never both):
                the error appears when the field is left, which a press on Checkout does, and
                anything below moving then would take Checkout from under the press. The longest
                error fits in two lines in a 320px-wide page. */}
            <div className="min-h-10" data-support-other-message="">
              {shownOtherError ? (
                <p id={otherErrorId} role="alert" className="text-sm text-danger">
                  {shownOtherError}
                </p>
              ) : (
                <p id={otherHintId} className="text-xs text-muted">
                  In Australian dollars, from {formatAud(SUPPORT_MIN_CENTS)} to {formatAud(SUPPORT_MAX_CENTS)}.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Always the height of the Remove button, so choosing doesn't move Checkout. */}
        <div className="flex min-h-11 items-center justify-end">
          {choice.option !== "none" && (
            <button
              type="button"
              onClick={remove}
              // The visible word starts the name (WCAG 2.5.3).
              aria-label={`Remove ${SUPPORT_LABEL}`}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-foreground underline underline-offset-4"
            >
              Remove
            </button>
          )}
        </div>

        {serverError && (
          <p id={serverErrorId} role="alert" className="text-sm text-danger">
            {serverError}
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** Support Sheltüh's own line in an order summary (a `<dl>`), only when there is some. */
export function SupportSummaryLine({ cents, className = "" }: { cents: number | undefined; className?: string }) {
  if (!cents || cents <= 0) return null;
  return (
    <div className={`flex justify-between gap-4 ${className}`.trim()} data-support-line="">
      <dt className="text-muted">{SUPPORT_LABEL}</dt>
      <dd className="tabular-nums text-foreground">{formatAud(cents)}</dd>
    </div>
  );
}
