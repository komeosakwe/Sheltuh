"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Admin lists keep their filter in the URL (`?status=`, and `?q=` where
 * there's a search), like the event queue (event-queue-filters.ts): a tab
 * can be linked to (the hub does), and survives a refresh. Defaults are left
 * out, so the bare path is the first filter.
 */

/** The value in the URL if it's one of `values`, else the default. */
export function pickParam<T extends string>(values: readonly { value: T }[], raw: string | null, fallback: T): T {
  return values.find((v) => v.value === raw)?.value ?? fallback;
}

/** `path` with the non-empty params as its query, in the order given. */
export function adminListHref(path: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) qs.set(name, value);
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * A list's status filter, read from and written to `?status=` (replacing the
 * history entry, without scrolling). The page must render this inside a
 * Suspense boundary (useSearchParams).
 */
export function useStatusParam<T extends string>(
  path: string,
  values: readonly { value: T }[],
  fallback: T,
): [T, (next: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const status = pickParam(values, params.get("status"), fallback);
  function setStatus(next: T) {
    router.replace(adminListHref(path, { status: next === fallback ? undefined : next }), { scroll: false });
  }
  return [status, setStatus];
}
