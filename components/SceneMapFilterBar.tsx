"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import SearchBar from "@/components/SearchBar";
import {
  CalendarIcon,
  ChevronDownIcon,
  DistanceIcon,
  LayersIcon,
  SearchIcon,
  TagIcon,
} from "@/components/map/MapControlIcons";
import LocationPicker from "@/components/search/LocationPicker";
import CountBadge from "@/components/ui/CountBadge";
import FilterChip, { filterChipClass, SelectedDots } from "@/components/ui/FilterChip";
import { DEFAULT_NEARBY_RADIUS, NEARBY_RADII_KM, parseNearbyRadius, type NearbyRadius } from "@/lib/map-near";
import type { ScenePricingFilter, TimeFilter } from "@/lib/scene-map-filters";
import type { EventCategory } from "@/lib/types";

/** The Distance filter's id, for focus to go to once "Show all of Australia" has changed it. */
export const NEARBY_DISTANCE_ID = "nearby-distance";

/** "Within 25 km", or "All of Australia" for no radius. */
export function radiusLabel(radius: NearbyRadius): string {
  return radius === "all" ? "All of Australia" : `Within ${radius} km`;
}

const PRICE_LABELS: Record<ScenePricingFilter, string> = { all: "Any price", free: "Free", under25: "Under A$25" };

interface Props {
  /** From lg: the search field and Where in a row. Below lg: the site's search bar (SearchBar), as on the home. */
  desktop: boolean;
  /** Below lg, whether the search bar shows here (the phone's map view floats it over the map instead). */
  showPhoneSearch?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  /** A place for this visit only (`/map?near=Sydney`), shown in Where instead of the remembered suburb. */
  near?: string;
  categories: { value: EventCategory; label: string }[];
  category: EventCategory | "all";
  onCategoryChange: (value: EventCategory | "all") => void;
  time: TimeFilter;
  onTimeChange: (value: TimeFilter) => void;
  specificDate: string;
  onSpecificDateChange: (value: string) => void;
  pricing: ScenePricingFilter;
  onPricingChange: (value: ScenePricingFilter) => void;
  /** The Distance filter's value; null hides it (no place to measure from yet). */
  radius: NearbyRadius | null;
  onRadiusChange: (value: NearbyRadius) => void;
  /** The radius doesn't apply for now ("Search this area"): Distance is disabled. */
  radiusPaused?: boolean;
  /** Below lg, beside the Filters button: the List | Map switch. */
  viewToggle?: ReactNode;
}

/**
 * Nearby's search, its one location control and its filters (the proposal's Nearby; the rules'
 * Tags & chips board, "Filters"). From lg: the search field (it filters the listed events as you
 * type) and Where (components/search/LocationPicker.tsx, standalone), 72px tall, then one row of
 * filters. Below lg: the site's search bar (one field opening the search sheet, as on the home,
 * with the same Where inside), then "Filters" (a disclosure: `aria-expanded`, named with how many
 * are set; Escape closes it) beside the List | Map switch, wrapping at 320px.
 *
 * The filters: Tonight and This weekend (toggle chips, `aria-pressed`), Date (a native date
 * field inside a chip, shown while focused), and All scenes, Any price and the Distance ("Within
 * 5 / 10 / 25 / 50 km" or All of Australia; only once there's a place to measure from), each a
 * chip with its icon, the choice and a chevron over an invisible native select. A filter is
 * active (black) when it's off its default: the default 25 km is not.
 */
export default function SceneMapFilterBar({
  desktop,
  showPhoneSearch = true,
  search,
  onSearchChange,
  near,
  categories,
  category,
  onCategoryChange,
  time,
  onTimeChange,
  specificDate,
  onSpecificDateChange,
  pricing,
  onPricingChange,
  radius,
  onRadiusChange,
  radiusPaused = false,
  viewToggle,
}: Props) {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const radiusActive = radius !== null && !radiusPaused && radius !== DEFAULT_NEARBY_RADIUS;
  const setCount = [time !== "all", category !== "all", pricing !== "all", radiusActive].filter(Boolean).length;
  const categoryLabel = category === "all" ? "All scenes" : (categories.find((c) => c.value === category)?.label ?? category);

  // Escape closes the panel (below lg, where it's a disclosure) and focus goes back to Filters.
  function handlePanelKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape" || desktop || !open || event.defaultPrevented) return;
    event.preventDefault();
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-8">
      {desktop ? (
        // `data-search-bar`: Where's menu is placed under this row (LocationPicker).
        <div data-search-bar="" className="flex flex-row gap-4">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="scene-search" className="sr-only">
              Search events, venues or suburbs
            </label>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-6 size-6 -translate-y-1/2 text-foreground" />
            <input
              id="scene-search"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search events, venues or suburbs"
              autoComplete="off"
              className="body-l h-18 w-full rounded-control border-control border-foreground bg-background pr-6 pl-16 text-foreground placeholder:text-muted"
            />
          </div>
          <div data-location-field="" className="w-120 shrink-0">
            <LocationPicker near={near} standalone />
          </div>
        </div>
      ) : (
        showPhoneSearch && (
          <div data-location-field="">
            <SearchBar near={near} />
          </div>
        )
      )}

      {!desktop && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            // The count is shown as a badge; the name says it in words ("Filters, 2 active").
            aria-label={setCount > 0 ? `Filters, ${setCount} active` : undefined}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className={filterChipClass(false)}
          >
            Filters
            <CountBadge count={setCount} srText="" dataAttribute="data-filter-count" />
          </button>
          {viewToggle}
        </div>
      )}

      {(desktop || open) && (
        <form
          id={panelId}
          aria-label="Filter events"
          data-filter-panel=""
          className="flex flex-wrap items-center gap-2 lg:gap-4"
          onSubmit={(event) => event.preventDefault()}
          onKeyDown={handlePanelKeyDown}
        >
          <FilterChip pressed={time === "tonight"} onClick={() => onTimeChange(time === "tonight" ? "all" : "tonight")}>
            <CalendarIcon className="size-5" />
            Tonight
          </FilterChip>
          <FilterChip pressed={time === "weekend"} onClick={() => onTimeChange(time === "weekend" ? "all" : "weekend")}>
            <CalendarIcon className="size-5" />
            This weekend
          </FilterChip>
          <DateChip
            value={specificDate}
            selected={time === "date"}
            onChange={(value) => {
              onSpecificDateChange(value);
              onTimeChange(value ? "date" : "all");
            }}
          />
          <SelectFilter
            id="scene-category-filter"
            label="Category"
            icon={LayersIcon}
            shown={categoryLabel}
            active={category !== "all"}
            value={category}
            onChange={(value) => onCategoryChange(value as EventCategory | "all")}
          >
            <option value="all">All scenes</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            id="scene-pricing-filter"
            label="Price"
            icon={TagIcon}
            shown={PRICE_LABELS[pricing]}
            active={pricing !== "all"}
            value={pricing}
            onChange={(value) => onPricingChange(value as ScenePricingFilter)}
          >
            {(Object.keys(PRICE_LABELS) as ScenePricingFilter[]).map((value) => (
              <option key={value} value={value}>
                {PRICE_LABELS[value]}
              </option>
            ))}
          </SelectFilter>
          {radius !== null && (
            <SelectFilter
              id={NEARBY_DISTANCE_ID}
              label="Distance"
              icon={DistanceIcon}
              shown={radiusLabel(radius)}
              active={radiusActive}
              disabled={radiusPaused}
              value={String(radius)}
              onChange={(value) => onRadiusChange(parseNearbyRadius(value))}
            >
              {NEARBY_RADII_KM.map((km) => (
                <option key={km} value={String(km)}>
                  {radiusLabel(km)}
                </option>
              ))}
              <option value="all">{radiusLabel("all")}</option>
            </SelectFilter>
          )}
        </form>
      )}
    </div>
  );
}

/** A focus ring around a chip whose native field is invisible inside it (the page's own ring, globals.css). */
const FOCUS_WITHIN =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-foreground has-[:focus-visible]:outline-solid";

/** A native select filling its chip, invisible, at 16px so iOS doesn't zoom. */
const NATIVE_OVERLAY = "absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0 disabled:cursor-not-allowed";

/**
 * A filter dropdown as a chip (the rules' Filters: default outlined, cream on hover, black when
 * active): its icon, the choice and a chevron beside it, over an invisible native select, so the
 * keyboard, screen readers and the phone's own picker all work unchanged. Named by `label`.
 */
function SelectFilter({
  id,
  label,
  icon: Icon,
  shown,
  active,
  disabled = false,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
  shown: string;
  active: boolean;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const look = disabled
    ? "label-button inline-flex h-12 shrink-0 items-center gap-2 rounded-control border-control border-disabled px-4 text-disabled"
    : filterChipClass(active);
  return (
    <span data-select-filter="" data-active={active ? "" : undefined} className={`${look} relative ${FOCUS_WITHIN}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon className="size-5" />
      <span aria-hidden="true">{shown}</span>
      <ChevronDownIcon className="size-4" />
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={NATIVE_OVERLAY}>
        {children}
      </select>
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
 * The date chip: a chip that shows its own words ("Date", or the day chosen) under a native date
 * field that fills it, so a tap anywhere opens the browser's own picker. The field is invisible
 * until it has focus; then it shows (on the page colour), so a keyboard user sees what they type.
 * iOS Safari ignores a date field's padding and shows an empty field with no placeholder, so the
 * field can't be the chip itself.
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
    <label data-date-chip="" className={filterChipClass(selected, `relative cursor-pointer ${FOCUS_WITHIN}`)}>
      {selected && <SelectedDots />}
      <CalendarIcon className="size-5" />
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
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-control bg-background px-2 text-base text-foreground opacity-0 focus:opacity-100"
      />
    </label>
  );
}
