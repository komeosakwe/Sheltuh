/**
 * The 🔥 before a few short urgency words ("🔥 Tomorrow", "🔥 Only 3 left."): decorative, so only
 * the words are read (aria-hidden, and never part of a string an element is described by). Put it
 * before the visible words only, inside their element, never in the words themselves.
 */
export default function Flame({ className = "mr-1" }: { className?: string }) {
  return (
    <span aria-hidden="true" data-flame="" className={className}>
      🔥
    </span>
  );
}
