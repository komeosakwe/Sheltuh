"use client";

import type { ReactNode } from "react";
import {
  CalendarIcon,
  ChevronDownIcon,
  LayersIcon,
  PinOutlineIcon,
  SearchIcon,
  TagIcon,
} from "@/components/map/MapControlIcons";
import type { EventCategory } from "@/lib/types";
import type { ScenePricingFilter, SuburbGroup, TimeFilter } from "@/lib/scene-map-filters";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  categories: { value: EventCategory; label: string }[];
  category: EventCategory | "all";
  onCategoryChange: (value: EventCategory | "all") => void;
  time: TimeFilter;
  onTimeChange: (value: TimeFilter) => void;
  specificDate: string;
  onSpecificDateChange: (value: string) => void;
  /** The events' suburbs, by state (lib/scene-map-filters.ts suburbsByState). */
  suburbGroups: SuburbGroup[];
  suburb: string | "all";
  onSuburbChange: (value: string | "all") => void;
  pricing: ScenePricingFilter;
  onPricingChange: (value: ScenePricingFilter) => void;
}

const PRICE_LABELS: Record<ScenePricingFilter, string> = { all: "Any price", free: "Free", under25: "Under $25" };

/**
 * /map's search, location and filter chips, as the owner's mockup (8 Nov 2026): two rounded ivory
 * fields with a soft shadow, then a row of pill chips (Tonight, This weekend, Date, All scenes,
 * Any price). A chosen chip is peach with an orange icon and bold words; a toggle chip also says
 * so with `aria-pressed`, and a select or date chip shows what's chosen.
 */
export default function SceneMapFilterBar({
  search,
  onSearchChange,
  categories,
  category,
  onCategoryChange,
  time,
  onTimeChange,
  specificDate,
  onSpecificDateChange,
  suburbGroups,
  suburb,
  onSuburbChange,
  pricing,
  onPricingChange,
}: Props) {
  const suburbLabel =
    suburb === "all"
      ? "All of Australia"
      : (suburbGroups.flatMap((group) => group.suburbs).find((option) => option.value === suburb)?.label ?? suburb);
  const categoryLabel = category === "all" ? "All scenes" : (categories.find((c) => c.value === category)?.label ?? category);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:flex-1">
          <label htmlFor="scene-search" className="sr-only">
            Search events, venues or suburbs
          </label>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-foreground" />
          {/* 16px typed text on phones (iOS zooms the page into a smaller field); the placeholder is the mockup's size. */}
          <input
            id="scene-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events, venues or suburbs"
            className={`${FIELD} pr-4 pl-10.5 text-base text-foreground placeholder:text-field placeholder:text-foreground/75 sm:text-field lg:text-sm lg:placeholder:text-sm`}
          />
        </div>

        {/* The look is drawn underneath; the native select fills it, invisible, so a tap opens the
            device's own picker (16px, so iOS doesn't zoom). */}
        <div data-location-field="" className={`relative h-10 rounded-2xl sm:w-60 lg:h-11 ${FOCUS_WITHIN}`}>
          <label htmlFor="scene-location" className="sr-only">
            Location
          </label>
          <span aria-hidden="true" className={`${FIELD} pointer-events-none absolute inset-0 flex items-center gap-2 pr-3.5 pl-4.25`}>
            <PinOutlineIcon className="size-4.25 text-foreground" />
            <span className="min-w-0 flex-1 truncate text-field font-medium text-foreground lg:text-sm">{suburbLabel}</span>
            <ChevronDownIcon className="size-4 text-foreground" />
          </span>
          <select
            id="scene-location"
            value={suburb}
            onChange={(event) => onSuburbChange(event.target.value)}
            className={NATIVE_OVERLAY}
          >
            <option value="all">All of Australia</option>
            {suburbGroups.map((group) => (
              <optgroup key={group.state} label={group.label}>
                {group.suburbs.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Phones: one row that scrolls sideways (bleeding to the screen's edges, starting a little left of
          the fields, as in the mockup); it wraps from 640px. The vertical padding keeps the chips' shadow
          and focus rings inside the scroller. */}
      <div className="-mx-5 -my-1 sm:mx-0 sm:my-0">
        <form
          aria-label="Filter events"
          className="no-scrollbar flex flex-nowrap items-center gap-1.25 overflow-x-auto px-4 py-2 sm:flex-wrap sm:gap-1.5 sm:overflow-visible sm:px-0 sm:py-0"
          onSubmit={(event) => event.preventDefault()}
        >
          <ToggleChip pressed={time === "tonight"} onClick={() => onTimeChange(time === "tonight" ? "all" : "tonight")}>
            Tonight
          </ToggleChip>
          <ToggleChip pressed={time === "weekend"} onClick={() => onTimeChange(time === "weekend" ? "all" : "weekend")}>
            This weekend
          </ToggleChip>
          <DateChip
            value={specificDate}
            selected={time === "date"}
            onChange={(value) => {
              onSpecificDateChange(value);
              onTimeChange(value ? "date" : "all");
            }}
          />

          <SelectChip label="Category" htmlFor="scene-category-filter" icon={LayersIcon} shown={categoryLabel} selected={category !== "all"}>
            <select
              id="scene-category-filter"
              value={category}
              onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
              className={NATIVE_OVERLAY}
            >
              <option value="all">All scenes</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </SelectChip>

          <SelectChip label="Price" htmlFor="scene-pricing-filter" icon={TagIcon} shown={PRICE_LABELS[pricing]} selected={pricing !== "all"}>
            <select
              id="scene-pricing-filter"
              value={pricing}
              onChange={(event) => onPricingChange(event.target.value as ScenePricingFilter)}
              className={NATIVE_OVERLAY}
            >
              <option value="all">Any price</option>
              <option value="free">Free</option>
              <option value="under25">Under $25</option>
            </select>
          </SelectChip>
        </form>
      </div>
    </div>
  );
}

/** The two fields' look: 40px (44px from lg), 16px corners, a soft hairline and shadow on ivory. */
const FIELD = "h-10 lg:h-11 w-full rounded-2xl border border-soft-line bg-panel shadow-soft";

/** A focus ring around a control whose native field is invisible inside it (the page's own ring, globals.css). */
const FOCUS_WITHIN =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground has-[:focus-visible]:outline-solid";

/** A native select or date field filling its chip or field, invisible, at 16px so iOS doesn't zoom. */
const NATIVE_OVERLAY = "absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0";

/** A chip's classes: a 32px pill (36px from lg, where the words are 12px); chosen, peach with bold words. `endPadding`: less beside a trailing chevron. */
export function mapChipClass(selected: boolean, className = "", endPadding = "pr-2.25 lg:pr-2.5") {
  return `inline-flex h-8 shrink-0 items-center gap-1 rounded-full border pl-2.25 text-2xs text-foreground shadow-soft lg:h-9 lg:gap-1.5 lg:pl-2.5 lg:text-xs ${endPadding} ${
    selected ? "border-signal/10 bg-peach font-bold" : "border-soft-line bg-panel font-medium hover:bg-surface"
  } ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

const chipIconClass = (selected: boolean) => `size-3.5 lg:size-4 ${selected ? "text-signal" : "text-foreground"}`;

function ToggleChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={mapChipClass(pressed)}>
      <CalendarIcon className={chipIconClass(pressed)} />
      {children}
    </button>
  );
}

/** A chip over an invisible native select (Category, Price): it shows the choice, and a tap opens the device's picker. */
function SelectChip({
  label,
  htmlFor,
  icon: Icon,
  shown,
  selected,
  children,
}: {
  label: string;
  /** The select's id, for its label. */
  htmlFor: string;
  icon: (props: { className?: string }) => ReactNode;
  shown: string;
  selected: boolean;
  children: ReactNode;
}) {
  return (
    <span data-select-chip="" className={mapChipClass(selected, `relative cursor-pointer ${FOCUS_WITHIN}`, "pr-2 lg:pr-2.25")}>
      <label htmlFor={htmlFor} className="sr-only">
        {label}
      </label>
      <Icon className={chipIconClass(selected)} />
      <span aria-hidden="true">{shown}</span>
      <ChevronDownIcon className="size-3.25 text-foreground" />
      {children}
    </span>
  );
}

/** "3 Nov" for a date field's YYYY-MM-DD (a calendar day, so no time zone shifts it). */
function shortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The date chip: a chip that shows its own words ("Date", or the day chosen) under an invisible
 * native date field that fills it, so a tap anywhere opens the browser's own picker. iOS Safari
 * ignores a date field's padding and shows an empty field with no placeholder, so the field
 * can't be the chip itself.
 */
function DateChip({
  value,
  selected,
  onChange,
}: {
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label data-date-chip="" className={mapChipClass(selected, `relative cursor-pointer ${FOCUS_WITHIN}`)}>
      <CalendarIcon className={chipIconClass(selected)} />
      <span aria-hidden="true">{value ? shortDate(value) : "Date"}</span>
      <input
        type="date"
        aria-label="Choose a date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          // Desktop browsers open the picker only from their own icon, which is hidden here.
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Not allowed here (e.g. inside a cross-origin frame): the field still takes typing.
          }
        }}
        className={NATIVE_OVERLAY}
      />
    </label>
  );
}
