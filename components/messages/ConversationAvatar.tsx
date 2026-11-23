import { initialsFor } from "@/lib/initials";

/** The tints Latte's Messages frames give conversation avatars (the category tag tints, each ≥ 4.5:1). */
const TONES = ["live-music", "pop-up", "workshop", "art", "theatre"] as const;

/** The same person gets the same tint in the list and the thread: picked from their name. */
export function conversationTone(name: string): (typeof TONES)[number] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TONES[hash % TONES.length];
}

const SIZES = { row: "size-11", head: "size-10" } as const;

/**
 * A conversation's round avatar (the Messages frames): the other person's initials in Label/Tag on
 * a category tint, 44px in the list and 40px in the thread's head. Decorative: the name beside it
 * is what's read.
 */
export default function ConversationAvatar({ name, size }: { name: string; size: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      data-tag={conversationTone(name)}
      className={`label-tag flex shrink-0 items-center justify-center rounded-full ${SIZES[size]}`}
    >
      {initialsFor(name)}
    </span>
  );
}
