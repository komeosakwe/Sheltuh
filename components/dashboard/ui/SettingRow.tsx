"use client";

import { useId } from "react";
import Toggle from "./Toggle";

/**
 * "Dash / Setting row" (Latte's dashboard Components 465:7337; Settings' Notifications): the
 * setting's name (Body/S Strong) over a line about it (Label/Tag, text/secondary), its switch on
 * the right. The switch is named by the title and described by the line, and the title is its
 * label: pressing the words toggles it too (a far bigger target than the 44 × 24 switch).
 */
export default function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <div data-setting-row="" className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <label id={titleId} htmlFor={`${id}-switch`} className="body-s cursor-pointer font-semibold break-words">
          {title}
        </label>
        {description && (
          <p id={descriptionId} className="label-tag break-words text-muted">
            {description}
          </p>
        )}
      </div>
      <Toggle
        id={`${id}-switch`}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      />
    </div>
  );
}
