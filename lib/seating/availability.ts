/**
 * Seat availability as a bitmap, shared by the API (GET
 * /api/events/{id}/seat-availability) and the seat page that polls it.
 *
 * One bit per seat, by its `position` in the map (lib/seating/template.ts,
 * flattenSeats): bit `p` is the (7 − p % 8)th bit of byte ⌊p / 8⌋, most
 * significant first. 1 means the seat can't be chosen: sold, held by someone
 * checking out, or blocked. The three look the same on purpose (decision 3,
 * docs/SEATING_PLAN.md): the public sees no sales split. The bytes travel as
 * standard base64 (`A–Z a–z 0–9 + /`, `=` padded): 10,000 seats is 1,250
 * bytes, about 1.7 KB of text.
 */

/** Bytes for `count` seats. */
export function availabilityByteLength(count: number): number {
  return Math.ceil(Math.max(0, count) / 8);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The bitmap for a map of `count` seats with `unavailable` positions set.
 * Positions outside 0…count−1 are ignored.
 */
export function encodeAvailability(count: number, unavailable: Iterable<number>): string {
  const bytes = new Uint8Array(availabilityByteLength(count));
  for (const position of unavailable) {
    if (!Number.isInteger(position) || position < 0 || position >= count) continue;
    bytes[position >> 3] |= 0x80 >> (position & 7);
  }
  return toBase64(bytes);
}

/**
 * The bitmap's bytes, or null when it isn't base64 of exactly the right
 * length for `count` seats (a stale map version, or a damaged response:
 * treat every seat as unavailable and refetch).
 */
export function decodeAvailability(encoded: string, count: number): Uint8Array | null {
  const bytes = fromBase64(encoded);
  if (!bytes || bytes.length !== availabilityByteLength(count)) return null;
  return bytes;
}

/** Whether the seat at `position` is unavailable in decoded bitmap `bits`. Out of range counts as unavailable. */
export function isSeatUnavailable(bits: Uint8Array, position: number): boolean {
  if (!Number.isInteger(position) || position < 0 || position >> 3 >= bits.length) return true;
  return (bits[position >> 3] & (0x80 >> (position & 7))) !== 0;
}

/** Every unavailable position, ascending; null for a bitmap that doesn't fit `count` seats. */
export function unavailablePositions(encoded: string, count: number): number[] | null {
  const bits = decodeAvailability(encoded, count);
  if (!bits) return null;
  const positions: number[] = [];
  for (let p = 0; p < count; p += 1) if (isSeatUnavailable(bits, p)) positions.push(p);
  return positions;
}
