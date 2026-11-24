/** A ticket transfer's short reference ("#1A2B3C4D"), shown to the recipient and support: never the order's (orderReference). */
export function transferReference(transferId: string): string {
  return `#${transferId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
