/** A count's pill number (nav counts, badges): capped at 99+. */
export function shownCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
