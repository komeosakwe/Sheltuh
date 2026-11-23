/** The first word of a person's name ("Alex" of "Alex Chen"), for "Alex sent you a ticket"; the whole name if it has one word. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/u)[0] ?? trimmed;
}
