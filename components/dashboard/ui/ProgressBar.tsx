/**
 * "Dash / Progress bar" (Latte's dashboard Components 465:7337): 8px tall, a brand/cream track
 * (surface/card-hover, `bg-hover`) and an orange fill, both with 4px ends. Sales against capacity
 * on the event and progress cards, check-ins on the Door card.
 *
 * With a `label` it's a progressbar ("Tickets sold", 86 of 120) for screen readers; without one
 * it's decoration beside words that already say it ("86 / 120 sold"), so it's hidden. Values are
 * clamped into 0…max; a max of 0 (nothing on sale) draws an empty track.
 */
export default function ProgressBar({
  value,
  max,
  label,
  className = "",
}: {
  value: number;
  max: number;
  label?: string;
  className?: string;
}) {
  const safeMax = Math.max(0, max);
  const now = Math.min(Math.max(0, value), safeMax);
  const percent = safeMax === 0 ? 0 : (now / safeMax) * 100;
  const a11y = label
    ? { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": safeMax, "aria-valuenow": now }
    : { "aria-hidden": true };
  return (
    <div {...a11y} data-progress-bar="" className={`h-2 w-full overflow-clip rounded-full bg-hover ${className}`.trim()}>
      <div data-progress-fill="" className="h-full rounded-full bg-signal" style={{ width: `${percent}%` }} />
    </div>
  );
}
