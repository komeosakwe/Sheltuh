/**
 * A short fingerprint of an order id (32-bit FNV-1a, hex), so what a browser
 * keeps about an order (lib/analytics.ts, lib/order-access.ts) is never the
 * order id itself: the id is the order page's credential.
 */
export function orderFingerprint(orderId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < orderId.length; i += 1) {
    hash ^= orderId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
