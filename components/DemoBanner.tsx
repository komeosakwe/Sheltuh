/**
 * The demo's one sample-data disclosure per page (docs/design/mobile-redesign.md,
 * Refinement 22 Oct 2026): a slim strip at the top of every page's content,
 * only in the demo (no Supabase env). Everything below it, the events, the
 * counts and the names, is sample data, and nothing is a real booking; the
 * booking points still say so where you'd act (DemoNotice).
 */
export default function DemoBanner() {
  return (
    <div role="note" aria-label="Demo" data-demo-banner="" className="border-b border-surface-border bg-surface">
      <p className="mx-auto max-w-6xl px-5 py-2 text-xs leading-4 sm:px-8 sm:text-sm sm:leading-5">
        <span className="font-semibold">Demo</span> · Sample data. No real bookings.
      </p>
    </div>
  );
}
