/** "—" on screen, "No data" to screen readers: a value that wasn't counted (never shown as 0). */
export default function NoData() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data</span>
    </>
  );
}

/** A formatted value, or "—" / "No data" when there isn't one. */
export function ValueOrNoData({ value }: { value: string | null }) {
  return value === null ? <NoData /> : <>{value}</>;
}
