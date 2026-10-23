"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, fieldClass } from "@/components/ui/Field";
import { daysInRange, isIsoDay } from "@/lib/analytics-format";
import { MAX_RANGE_DAYS, PRESET_LABELS, resolveRange, type RangePreset, type RangeState } from "@/lib/analytics-range";

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "12m", "all", "custom"];

/** Why a custom range can't be used, or null if it can. */
export function customRangeError(from: string, to: string, today: string): string | null {
  if (!isIsoDay(from) || !isIsoDay(to)) return "Choose a start and an end date.";
  if (to < from) return "Choose an end date on or after the start date.";
  if (to > today) return "Choose an end date no later than today.";
  if (daysInRange(from, to) > MAX_RANGE_DAYS) return "Choose a range of two years or less.";
  return null;
}

/**
 * Date range and compare (docs/design/favourites-analytics.md §5.9). Presets
 * apply as soon as they're picked; custom dates apply on Apply. `rangeError`
 * is the API's own complaint about the range (a 400), shown under To.
 */
export default function RangeControls({
  value,
  onChange,
  allowAllTime,
  busy,
  today,
  rangeError,
}: {
  value: RangeState;
  onChange: (range: RangeState) => void;
  allowAllTime: boolean;
  busy: boolean;
  today: string;
  rangeError?: string | null;
}) {
  const id = useId();
  const toRef = useRef<HTMLInputElement>(null);
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");
  const resolved = resolveRange(value, today);
  const [from, setFrom] = useState(resolved.from ?? today);
  const [to, setTo] = useState(resolved.to ?? today);
  const [error, setError] = useState<string | null>(null);

  const selected: RangePreset = customOpen ? "custom" : value.preset;
  const shownError = error ?? (value.preset === "custom" ? (rangeError ?? null) : null);
  const allTime = selected === "all";

  function pick(preset: RangePreset) {
    setError(null);
    if (preset === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange({ preset, compare: preset === "all" ? false : value.compare });
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    const problem = customRangeError(from, to, today);
    setError(problem);
    if (problem) {
      toRef.current?.focus();
      return;
    }
    onChange({ preset: "custom", from, to, compare: value.compare });
  }

  return (
    <form onSubmit={apply} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6" aria-busy={busy || undefined}>
      <Field label="Date range" htmlFor={`${id}-range`}>
        <select
          id={`${id}-range`}
          className={`${fieldClass} sm:w-56`}
          value={selected}
          onChange={(e) => pick(e.target.value as RangePreset)}
        >
          {PRESETS.filter((preset) => allowAllTime || preset !== "all").map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </Field>

      {customOpen && (
        <>
          <Field label="From" htmlFor={`${id}-from`}>
            <input
              id={`${id}-from`}
              type="date"
              className={`${fieldClass} sm:w-44`}
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-to`} className="eyebrow text-muted">
              To
            </label>
            <input
              ref={toRef}
              id={`${id}-to`}
              type="date"
              className={`${fieldClass} sm:w-44`}
              value={to}
              max={today}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError ? `${id}-to-error` : undefined}
              onChange={(e) => setTo(e.target.value)}
            />
            {shownError && (
              <p id={`${id}-to-error`} className="text-sm text-danger">
                {shownError}
              </p>
            )}
          </div>
          <Button type="submit" variant="outline" size="lg" className="sm:min-h-11 sm:px-6 sm:py-2.5 sm:text-xs/4.5" busy={busy}>
            Apply
          </Button>
        </>
      )}

      <div className="flex flex-col">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={value.compare && !allTime}
            disabled={allTime}
            aria-describedby={allTime ? `${id}-compare-note` : undefined}
            onChange={(e) => onChange({ ...value, compare: e.target.checked })}
          />
          Compare with the previous period
        </label>
        {allTime && (
          <p id={`${id}-compare-note`} className="text-xs text-muted">
            There&rsquo;s no earlier period to compare with All time.
          </p>
        )}
      </div>
    </form>
  );
}
