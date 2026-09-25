/**
 * A unique ID that also sorts lexicographically by creation time, so a plain
 * DynamoDB Query on a partition (no extra sort attribute needed) returns
 * items in creation order.
 */
export function newSortableId(): string {
  const timePart = Date.now().toString(36).padStart(9, "0");
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${timePart}-${randomPart}`;
}
