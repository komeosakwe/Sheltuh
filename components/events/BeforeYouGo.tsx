import { BEFORE_YOU_GO_TITLE, type BeforeYouGoItem } from "@/lib/before-you-go";

/**
 * The organiser's "Before you go" rows on the event page (and the editor's preview of it): a 1px rule, 24px
 * padding, the control radius (8px), the title in semibold, then each row's label (uppercase) and value as a
 * description list. Plain text, escaped by React. Nothing without rows. (The owner's "The essentials." design
 * replaces this layout next.)
 */
export default function BeforeYouGo({ items, className = "" }: { items: readonly BeforeYouGoItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="before-you-go-title"
      data-before-you-go=""
      className={`flex flex-col gap-2 rounded-control border border-foreground p-6 ${className}`.trim()}
    >
      <h2 id="before-you-go-title" className="body-m font-semibold">
        {BEFORE_YOU_GO_TITLE}
      </h2>
      <dl className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="body-s break-words">
            <dt className="eyebrow uppercase text-muted">{item.label}</dt>
            <dd className="text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
