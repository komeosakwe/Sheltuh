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

/** Longest address accepted (RFC 5321's path limit, less the angle brackets). */
export const MAX_EMAIL_LENGTH = 254;

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
/**
 * One plain address: an unquoted local part of [A-Za-z0-9._%+-] (at most 64
 * characters), then a domain of DNS labels with at least one dot and a top
 * level starting with a letter. Deliberately narrower than RFC 5322: nothing
 * that mail software would read as a display name, comment, group, quoted
 * local part or list of recipients (`, ; < > ( ) " : [ ] \` and spaces), so
 * a stored address can never become more than one recipient.
 */
const PLAIN_EMAIL = new RegExp(`^[A-Za-z0-9._%+-]{1,64}@(?:${LABEL}\\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`);

export function isPlainEmailAddress(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && PLAIN_EMAIL.test(email);
}

// The domain may be empty, so an address cut short by the scan limit ("fan@") is still redacted.
const EMAIL_LIKE = /[^\s<>"'(),;:@]+@[^\s<>"'(),;:@]*/g;
/** Longest input redactForLog scans: bounds the regex's work on a huge error message. */
const REDACT_SCAN_LIMIT = 2000;

/**
 * Text safe to log or store: anything that looks like an email address is
 * replaced, control characters are dropped and it's cut to `max` characters.
 * SMTP servers often echo the recipient back in their error messages. The
 * input is cut first (with room for redaction to shorten it), so the regex
 * never runs over an unbounded string.
 */
export function redactForLog(text: string, max = 200): string {
  return text
    .slice(0, Math.min(REDACT_SCAN_LIMIT, max * 4))
    .replace(EMAIL_LIKE, "[address]")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, max);
}
