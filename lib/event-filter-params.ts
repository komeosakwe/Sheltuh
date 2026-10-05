import { EVENT_CATEGORIES, type EventCategory } from "./types";

export type CategoryFilter = EventCategory | "all";
export type PricingFilter = "all" | "free" | "paid";

export interface EventFilterParams {
  category: CategoryFilter;
  pricing: PricingFilter;
}

type SearchParamValue = string | string[] | undefined;

const firstValue = (value: SearchParamValue) => (Array.isArray(value) ? value[0] : value);

/**
 * The /events starting filters from `?category=&pricing=` (e.g. the phone
 * home's category row). Only the first value of each counts, and anything
 * that isn't a known category or pricing option falls back to "all".
 */
export function parseEventFilterParams(params: Record<string, SearchParamValue>): EventFilterParams {
  const category = firstValue(params.category);
  const pricing = firstValue(params.pricing);
  return {
    category: EVENT_CATEGORIES.find((c) => c.value === category)?.value ?? "all",
    pricing: pricing === "free" || pricing === "paid" ? pricing : "all",
  };
}
