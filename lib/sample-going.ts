import type { GoingAttendee } from "@/lib/api/types";

/**
 * Demo-mode "Who's Going" names: fictional first names and initials, so the
 * panel can be previewed without a backend. A pure function of the event id
 * (no randomness, dates or locale), so the server render and the browser's
 * hydration always agree.
 */

const FIRST_NAMES = [
  "Mia", "Leo", "Aisha", "Tom", "Priya", "Sam", "Hana", "Oscar", "Zara", "Kai",
  "Lucia", "Ben", "Ngaio", "Theo", "Ruby", "Jonah", "Ines", "Felix", "Amara", "Nico",
  "Wren", "Isla", "Mateo", "Esther", "Jules", "Tahlia", "Arjun", "Maeve", "Quinn", "Soraya",
] as const;

const LAST_INITIALS = "ABCDEFGHJKLMNPRSTVWY";

export const SAMPLE_GOING_MIN = 8;
export const SAMPLE_GOING_MAX = 22;

/** FNV-1a: small, stable across runtimes, good enough to spread seeds. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic pseudo-random sequence (a 32-bit LCG) from a seed. */
function sequence(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

export interface SampleGoing {
  count: number;
  attendees: GoingAttendee[];
}

export function getSampleGoing(eventId: string): SampleGoing {
  const next = sequence(hash(eventId));
  const count = SAMPLE_GOING_MIN + (next() % (SAMPLE_GOING_MAX - SAMPLE_GOING_MIN + 1));

  // Walk the first-name list from a seeded start with a seeded stride that's
  // coprime with its length, so no first name repeats within an event.
  const start = next() % FIRST_NAMES.length;
  const strides = [1, 7, 11, 13, 17, 19, 23, 29];
  const stride = strides[next() % strides.length];

  const attendees: GoingAttendee[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[(start + i * stride) % FIRST_NAMES.length];
    const initial = LAST_INITIALS[next() % LAST_INITIALS.length];
    attendees.push({ attendeeId: `sample-${eventId}-${i}`, displayName: `${first} ${initial}.`, isYou: false });
  }
  return { count, attendees };
}
