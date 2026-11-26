import { SAVED_GRID } from "@/components/ui/grids";

/** Three cards' shapes while My tickets loads (no shimmer); the page's status line says it. */
export default function TicketsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="h-7 w-40 rounded-badge bg-surface" aria-hidden="true" />
      <ul aria-hidden="true" className={SAVED_GRID} data-my-tickets-loading="">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex flex-col gap-4 rounded-card border border-surface-border bg-card p-4">
            <div className="flex items-center gap-4">
              <div className="size-22 shrink-0 rounded-control bg-surface" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-24 max-w-full rounded-badge bg-surface" />
                <div className="h-6 w-full rounded-badge bg-surface" />
                <div className="h-4 w-32 max-w-full rounded-badge bg-surface" />
              </div>
            </div>
            <div className="h-4 w-40 max-w-full rounded-badge bg-surface" />
            <div className="h-14 w-full rounded-control bg-surface" />
          </li>
        ))}
      </ul>
    </div>
  );
}
