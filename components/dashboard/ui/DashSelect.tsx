"use client";

import { useId, type SelectHTMLAttributes } from "react";
import { ChevronDownIcon } from "./icons";

export interface DashSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * "Dash / Select" (Latte's dashboard Components 465:7337, node 496:20776): the page colour, the
 * 1.5px foreground stroke, radius 8, pl 16 pr 12 py 8, the value in Label/Button with a 20px
 * chevron (Public ▾, Paid ▾, Buyers pay ▾, This month ▾, Here & Now ▾). A native select, so its
 * keyboard, screen-reader and phone pickers are the browser's own (and the open list is the
 * site's rounded one where the browser has it: globals.css "Dropdown lists"). It needs a name:
 * `label` is shown above it, or with `hideLabel` read only (when the row already says what it's
 * for, as "Who can find this event? [Public ▾]" does: point `aria-labelledby` at that instead).
 */
export default function DashSelect({
  label,
  hideLabel = false,
  options,
  className = "",
  id: givenId,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: string;
  hideLabel?: boolean;
  options: DashSelectOption[];
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <div data-dash-select="" className={`inline-flex min-w-0 flex-col gap-2 ${className}`.trim()}>
      {label && (
        <label htmlFor={id} className={hideLabel ? "sr-only" : "mono-s text-muted"}>
          {label}
        </label>
      )}
      <span className="relative inline-flex min-w-0">
        <select
          {...props}
          id={id}
          className="label-button min-h-10 w-full min-w-0 cursor-pointer appearance-none rounded-control border-control border-foreground bg-background py-2 pr-10 pl-4 text-foreground"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2" />
      </span>
    </div>
  );
}
