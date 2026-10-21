/**
 * Order ids look like `ord_<32 hex>`. The full id is the confirmation page's
 * bearer credential (guest checkout has no account), so it's never logged or
 * shown anywhere it doesn't have to be.
 */
export const ORDER_ID_PATTERN = /^ord_[0-9a-f]{32}$/;

/**
 * A short reference for support and logs: the first 8 characters of the order
 * id's random part (the `ord_` prefix and any dashes are dropped first so the
 * reference is 8 useful characters). Not a credential: 32 bits of a 128-bit id.
 */
export function orderReference(orderId: string): string {
  return `#${orderId.replace(/^ord_/, "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
