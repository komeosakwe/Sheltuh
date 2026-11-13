"use client";

import CategoryIcon from "@/components/home/CategoryIcon";
import { HOME_CATEGORIES } from "@/components/home/CategoryRow";
import type { SearchSuggestion, SearchSuggestionGroup } from "@/lib/search-suggestions";

/** An option's element id, for the field's aria-activedescendant. */
export function suggestionOptionId(listId: string, option: SearchSuggestion): string {
  return `${listId}-${option.key}`;
}

/**
 * The search field's suggestions (components/SearchBar.tsx): a listbox of grouped options, drawn
 * as the site's dropdown lists (globals.css, "Dropdown lists"): a rounded card on the soft
 * shadow, 8px inside, rows with cream under the pointer or the keyboard's choice. Always in the
 * page (the field's aria-controls points at it), hidden while closed. Focus stays in the field
 * (aria-activedescendant): a press on an option keeps it there, so the list isn't closed by the
 * field losing focus first.
 *
 * Below md it sits in the search sheet's flow, under Search, where nothing follows it; from md it
 * floats under the bar, so nothing on the page moves.
 */
export default function SearchSuggestions({
  id,
  open,
  groups,
  activeKey,
  onActivate,
  onPick,
}: {
  id: string;
  open: boolean;
  groups: SearchSuggestionGroup[];
  /** The option the keyboard (or pointer) is on, or null. */
  activeKey: string | null;
  onActivate: (key: string) => void;
  onPick: (option: SearchSuggestion) => void;
}) {
  return (
    <div
      hidden={!open}
      data-search-suggestions=""
      className="w-full rounded-card border border-surface-border bg-card p-2 text-left text-foreground shadow-soft md:absolute md:top-full md:left-0 md:z-30 md:mt-2 md:max-w-md"
    >
      <div id={id} role="listbox" aria-label="Search suggestions" className="flex flex-col gap-2">
        {groups.map((group) => {
          const titleId = `${id}-${group.key}-title`;
          return (
            <div key={group.key} role="group" aria-labelledby={titleId}>
              <div id={titleId} role="presentation" className="eyebrow px-3 pt-1 pb-1 text-muted">
                {group.title}
              </div>
              {group.options.map((option) => (
                <SuggestionRow
                  key={option.key}
                  id={suggestionOptionId(id, option)}
                  option={option}
                  active={option.key === activeKey}
                  onActivate={() => onActivate(option.key)}
                  onPick={() => onPick(option)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionRow({
  id,
  option,
  active,
  onActivate,
  onPick,
}: {
  id: string;
  option: SearchSuggestion;
  active: boolean;
  onActivate: () => void;
  onPick: () => void;
}) {
  const icon = option.kind === "category" ? HOME_CATEGORIES.find((item) => item.category === option.category)?.icon : undefined;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-suggestion={option.kind}
      // Keeps focus in the field: a press would blur it first, closing the list before the click.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={active ? undefined : onActivate}
      onClick={onPick}
      className={`flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 ${
        option.kind === "event" ? "min-h-12" : "min-h-10"
      } ${active ? "bg-hover dark:bg-surface" : ""}`}
    >
      {icon && <CategoryIcon name={icon} className="size-5 shrink-0" />}
      {option.kind === "event" ? (
        <span className="flex min-w-0 flex-col">
          <span className="text-base leading-6 font-semibold break-words">{option.label}</span>
          <span className="text-sm leading-5 break-words text-muted">{option.detail}</span>
        </span>
      ) : (
        <span className="text-base leading-6">{option.label}</span>
      )}
    </div>
  );
}
