import type { BeforeYouGoItem } from "@/lib/before-you-go";

/** The section's heading on the event page (the owner's "Editorial minimal" reference, 22 Nov 2026). */
export const ESSENTIALS_TITLE = "The essentials";
const ESSENTIALS_TITLE_ID = "essentials-title";

/** "01", "02", ...: the row's number as the reference shows it. */
function rowNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * The organiser's "Before you go" rows on the event page (and the editor's preview of it), as the owner's
 * reference draws them: "The essentials." in the heading style (the full stop in Signal Orange, large text),
 * then one ruled row per item, "01 / ENTRY" on the left and the value right-aligned. The label is shown
 * uppercase by CSS (stored as typed) in --signal-text, the orange that holds 4.5:1 at small sizes (the
 * reference's #ff4800 doesn't). The number is decorative (aria-hidden), so a screen reader hears
 * "Entry: 7:30 pm – 10:30 pm" from the <dt>/<dd> pair. A value too long to sit beside its label wraps in
 * its column; when the label leaves it less than 10rem, it moves under the label, still right-aligned.
 * Plain text, escaped by React. Nothing without rows.
 */
export default function BeforeYouGo({ items, className = "" }: { items: readonly BeforeYouGoItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={ESSENTIALS_TITLE_ID} data-before-you-go="" className={className}>
      <h2 id={ESSENTIALS_TITLE_ID} className="font-heading text-4xl leading-10 break-words md:heading-page">
        {ESSENTIALS_TITLE}
        <span className="text-signal">.</span>
      </h2>
      <dl className="mt-5 md:mt-6">
        {items.map((item, index) => (
          <div
            key={index}
            data-before-you-go-row=""
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-surface-border py-5.5 md:py-6"
          >
            <dt className="min-w-0 text-xs leading-4 font-bold tracking-widest break-words text-signal-text uppercase md:text-sm md:leading-5">
              <span aria-hidden="true">{rowNumber(index)} / </span>
              {item.label}
            </dt>
            <dd className="min-w-0 flex-1 basis-40 body-l text-right break-words text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
