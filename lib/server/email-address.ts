/**
 * Helpers for buyer email addresses that must never leak in full: masking
 * for display to whoever holds an order link, and redaction for logs and
 * stored error text.
 */

/**
 * "mia@example.com" → "m***@example.com". Enough for the buyer to recognise
 * their own address, not enough for anyone else who sees the page to learn it.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

const EMAIL_LIKE = /[^\s<>"'(),;:@]+@[^\s<>"'(),;:@]+/g;

/**
 * Text safe to log or store: anything that looks like an email address is
 * replaced, control characters are dropped and it's cut to `max` characters.
 * SMTP servers often echo the recipient back in their error messages.
 */
export function redactForLog(text: string, max = 200): string {
  return text.replace(EMAIL_LIKE, "[address]").replace(/\p{Cc}+/gu, " ").trim().slice(0, max);
}
