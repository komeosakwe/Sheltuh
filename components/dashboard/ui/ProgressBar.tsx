/**
 * "Dash / Progress bar" (Latte's dashboard Components 465:7337): 8px tall, a brand/cream track
 * (surface/card-hover, `bg-hover`) and an orange fill, both with 4px ends. Sales against capacity
 * on the event and progress cards, check-ins on the Door card.
 *
 * The cream track is barely there on white (1.05:1) and the orange fill is 3.4:1, so the bar is
 * never the only place the figure is: every use sits beside words that say it ("86 / 120 sold",
 * "45 / 86 checked in"). With a `label` it's also a progressbar for screen readers, read with
 * `valueText` ("Tickets sold, 86 of 120 sold"); without one it's decoration and hidden. Values are
 * clamped into 0…max; a max of 0 (nothing on sale) draws an empty track.
 */
type Labelled = { label: string; valueText: string } | { label?: undefined; valueText?: undefined };

export default function ProgressBar({
  value,
  max,
  label,
  valueText,
  className = "",
}: {
  value: number;
  max: number;
  className?: string;
} & Labelled) {
  const safeMax = Math.max(0, max);
  const now = Math.min(Math.max(0, value), safeMax);
  const percent = safeMax === 0 ? 0 : (now / safeMax) * 100;
  const a11y = label
    ? {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": safeMax,
        "aria-valuenow": now,
        "aria-valuetext": valueText,
      }
    : { "aria-hidden": true };
  return (
    <div {...a11y} data-progress-bar="" className={`h-2 w-full overflow-clip rounded-full bg-hover ${className}`.trim()}>
      <div data-progress-fill="" className="h-full rounded-full bg-signal" style={{ width: `${percent}%` }} />
    </div>
  );
}
