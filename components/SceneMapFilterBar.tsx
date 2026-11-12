"use client";

import { useId, useState, type ReactNode } from "react";
import { CalendarIcon, SearchIcon } from "@/components/map/MapControlIcons";
import LocationPicker from "@/components/search/LocationPicker";
import CountBadge from "@/components/ui/CountBadge";
import FilterChip, { filterChipClass, SelectedDots } from "@/components/ui/FilterChip";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { DEFAULT_NEARBY_RADIUS, NEARBY_RADII_KM, parseNearbyRadius, type NearbyRadius } from "@/lib/map-near";
import type { ScenePricingFilter, TimeFilter } from "@/lib/scene-map-filters";
import type { EventCategory } from "@/lib/types";

/** The Distance filter's id, for focus to go to once "Show all of Australia" has changed it. */
export const NEARBY_DISTANCE_ID = "nearby-distance";

/** "Within 25 km", or "All of Australia" for no radius. */
export function radiusLabel(radius: NearbyRadius): string {
  return radius === "all" ? "All of Australia" : `Within ${radius} km`;
}

interface Props {
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
  /** Below lg, beside the Filters button: the List | Map switch. */
  viewToggle?: ReactNode;
}

/**
 * Nearby's search, its one location control and its filters (the proposal's Nearby; the rules'
 * Tags & chips board, "Filters"). The search field filters the listed events as you type; Where
 * is the site's one location (components/search/LocationPicker.tsx, standalone): what it sets is
 * the remembered suburb every page uses, and Nearby measures from it.
 *
 * The filters are one row from lg: Tonight and This weekend (toggle chips, `aria-pressed`), Date
 * (a native date field inside a chip), All scenes and Any price (FilterDropdown), and the
 * Distance, "Within 5 / 10 / 25 / 50 km" or All of Australia (black while a radius applies; only
 * once there's a place to measure from). Below lg they sit behind a "Filters" button (a
 * disclosure: `aria-expanded`, with how many are set), beside the List | Map switch.
 */
export default function SceneMapFilterBar({
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
  viewToggle,
}: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const setCount = [
    time !== "all",
    category !== "all",
    pricing !== "all",
    radius !== null && radius !== DEFAULT_NEARBY_RADIUS,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      {/* `data-search-bar`: Where's menu is placed under this row (LocationPicker). */}
      <div data-search-bar="" className="flex flex-col gap-4 md:flex-row">
        <div className="relative md:min-w-0 md:flex-1">
          <label htmlFor="scene-search" className="sr-only">
            Search events, venues or suburbs
          </label>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-foreground" />
          {/* 16px, so iOS doesn't zoom the page into the field. */}
          <input
            id="scene-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events, venues or suburbs"
            autoComplete="off"
            className="h-12 w-full rounded-control border-control border-foreground bg-background pr-4 pl-12 text-base text-foreground placeholder:text-muted"
          />
        </div>
        <div data-location-field="" className="md:w-80 lg:w-96">
          <LocationPicker near={near} standalone />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className={filterChipClass(false)}
        >
          Filters
          <CountBadge count={setCount} srText={`, ${setCount} active`} dataAttribute="data-filter-count" />
        </button>
        {viewToggle}
      </div>

      <form
        id={panelId}
        aria-label="Filter events"
        data-filter-panel=""
        className={`${open ? "flex" : "hidden"} flex-wrap items-center gap-2 lg:flex lg:gap-4`}
        onSubmit={(event) => event.preventDefault()}
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
        <FilterDropdown
          id="scene-category-filter"
          label="Category"
          active={category !== "all"}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
        >
          <option value="all">All scenes</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </FilterDropdown>
        <FilterDropdown
          id="scene-pricing-filter"
          label="Price"
          active={pricing !== "all"}
          value={pricing}
          onChange={(event) => onPricingChange(event.target.value as ScenePricingFilter)}
        >
          <option value="all">Any price</option>
          <option value="free">Free</option>
          <option value="under25">Under A$25</option>
        </FilterDropdown>
        {radius !== null && (
          <FilterDropdown
            id={NEARBY_DISTANCE_ID}
            label="Distance"
            active={radius !== "all"}
            value={String(radius)}
            onChange={(event) => onRadiusChange(parseNearbyRadius(event.target.value))}
          >
            {NEARBY_RADII_KM.map((km) => (
              <option key={km} value={String(km)}>
                {radiusLabel(km)}
              </option>
            ))}
            <option value="all">{radiusLabel("all")}</option>
          </FilterDropdown>
        )}
      </form>
    </div>
  );
}

/** A focus ring around a chip whose native field is invisible inside it (the page's own ring, globals.css). */
const FOCUS_WITHIN =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-foreground has-[:focus-visible]:outline-solid";

/** A native date field filling its chip, invisible, at 16px so iOS doesn't zoom. */
const NATIVE_OVERLAY = "absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0";

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
        className={NATIVE_OVERLAY}
      />
    </label>
  );
}
