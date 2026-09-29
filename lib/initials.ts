const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]/u;

function firstGrapheme(word: string): string {
  for (const { segment } of segmenter.segment(word)) return segment;
  return "";
}

/**
 * Initials for a display name's avatar square: the first grapheme of the
 * first and last words, uppercased ("Mia T." → "MT", "Émile" → "É").
 * A name that doesn't start with a letter or number (an emoji, say) gets "·".
 */
export function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "·";
  const first = firstGrapheme(words[0]);
  if (!LETTER_OR_NUMBER.test(first)) return "·";
  const last = words.length > 1 ? firstGrapheme(words[words.length - 1]) : "";
  return (first + (LETTER_OR_NUMBER.test(last) ? last : "")).toLocaleUpperCase("en-AU");
}
