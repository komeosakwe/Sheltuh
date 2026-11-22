import type { BeforeYouGoItem } from "@/lib/before-you-go";

/**
 * TEMPORARY (until the editor's own rows UI): the "Before you go" rows as one
 * textarea, a row per line written "Label: value" (split at the first colon,
 * so "Entry: 7:30 pm" is Entry and 7:30 pm). A line without a colon is a
 * value with no label, which validateBeforeYouGo refuses as half-filled.
 * Blank lines are blank rows (dropped).
 */
export function beforeYouGoFromText(text: string): BeforeYouGoItem[] {
  return text.split(/\r\n?|\n/).map((line) => {
    const colon = line.indexOf(":");
    return colon < 0 ? { label: "", value: line } : { label: line.slice(0, colon), value: line.slice(colon + 1) };
  });
}

/** The stored rows as the textarea shows them ("Label: value" per line). */
export function beforeYouGoToText(items: readonly BeforeYouGoItem[] | undefined): string {
  return (items ?? []).map((item) => `${item.label}: ${item.value}`).join("\n");
}
