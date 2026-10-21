import { TICKET_CODE_ALPHABET, TICKET_QR_PREFIX } from "@/lib/ticket-code";

/**
 * A typed code, made canonical (docs/design/check-in.md §5.A6): trim, upper
 * case, drop a leading `SH1:`, remove spaces and hyphens; eight characters
 * from the ticket alphabet become `XXXX-XXXX`. Anything else is null and
 * isn't sent.
 */
export function normaliseTypedCode(raw: string): string | null {
  let value = raw.trim().toUpperCase();
  if (value.startsWith(TICKET_QR_PREFIX)) value = value.slice(TICKET_QR_PREFIX.length);
  value = value.replace(/[\s-]+/g, "");
  if (value.length !== 8) return null;
  for (const char of value) if (!TICKET_CODE_ALPHABET.includes(char)) return null;
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}
