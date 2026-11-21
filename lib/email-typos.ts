/**
 * Buyer email typo checks, shared by the checkout panel (a "Did you mean …?"
 * hint) and the API (docs/architecture.md, "Buyer email checks"). No
 * dependency and no network: a hand-picked list of mistyped domains, a list of
 * mail providers known to be right, and a one-edit match against popular
 * providers for the hint.
 *
 * Only `EMAIL_TYPO_DOMAINS` refuses anything (the API answers 400
 * `email_typo`, whatever the domain's DNS says: a typo domain can have a mail
 * server that isn't the buyer's). The one-edit match only ever suggests, so a
 * real domain that happens to be one letter from a popular one is never
 * blocked. Keep the list hand-picked: every entry blocks a checkout.
 */

/**
 * Mistyped domains and what was meant. Every key is a domain nobody should
 * have their tickets sent to: refused at checkout, with the correction offered.
 */
export const EMAIL_TYPO_DOMAINS: Readonly<Record<string, string>> = Object.freeze({
  // Gmail
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmaiil.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.cmo": "gmail.com",
  "gmail.cpm": "gmail.com",
  "gmail.vom": "gmail.com",
  "gmail.xom": "gmail.com",
  // Gmail has no Australian domain: "gmail.com.au" is someone else's.
  "gmail.com.au": "gmail.com",
  // Hotmail
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmil.com": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "hotamil.com": "hotmail.com",
  "homail.com": "hotmail.com",
  "hotnail.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "hotmail.con.au": "hotmail.com.au",
  // Outlook
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlool.com": "outlook.com",
  "outllok.com": "outlook.com",
  "oulook.com": "outlook.com",
  "outook.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "outlook.con.au": "outlook.com.au",
  // Yahoo
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahho.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yahoo.cm": "yahoo.com",
  "yahoo.con.au": "yahoo.com.au",
  // iCloud
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "icluod.com": "icloud.com",
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
  // Live
  "live.con": "live.com",
  "live.con.au": "live.com.au",
  // Australian providers
  "bigpon.com": "bigpond.com",
  "bigpnd.com": "bigpond.com",
  "bigppond.com": "bigpond.com",
  "biqpond.com": "bigpond.com",
  "bigpond.con": "bigpond.com",
  "bigpond.con.au": "bigpond.com.au",
  "optusnet.con.au": "optusnet.com.au",
  "optunet.com.au": "optusnet.com.au",
  "optusnet.com.a": "optusnet.com.au",
});

/**
 * Mail providers known to be right as typed: accepted without a DNS lookup,
 * and never "corrected" by the one-edit hint (mail.com, email.com and
 * ymail.com are each one letter from gmail.com, and all real).
 */
export const KNOWN_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.com.au",
  "hotmail.com",
  "hotmail.com.au",
  "hotmail.co.uk",
  "hotmail.co.nz",
  "live.com",
  "live.com.au",
  "msn.com",
  "yahoo.com",
  "yahoo.com.au",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "mail.com",
  "email.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "xtra.co.nz",
  // Australian ISPs
  "bigpond.com",
  "bigpond.com.au",
  "bigpond.net.au",
  "optusnet.com.au",
  "iinet.net.au",
  "internode.on.net",
  "tpg.com.au",
  "westnet.com.au",
  "dodo.com.au",
  "adam.com.au",
  "ozemail.com.au",
  "aapt.net.au",
  "exetel.com.au",
]);

/**
 * Popular providers the hint matches within one edit. Only long names: a
 * short one (me.com, aol.com) is one edit from too many real domains.
 */
const HINT_TARGETS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.au",
  "outlook.com",
  "outlook.com.au",
  "yahoo.com",
  "yahoo.com.au",
  "icloud.com",
  "bigpond.com",
  "bigpond.net.au",
  "optusnet.com.au",
  "iinet.net.au",
  "protonmail.com",
] as const;

/** Shortest domain the hint considers: anything shorter is too close to too much. */
const HINT_MIN_LENGTH = 6;

/** The address's domain, lower-cased (after the last "@"), or null when there's no "@" or nothing after it. */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain === "" ? null : domain;
}

/** The domain meant, when `domain` is on the typo list (EMAIL_TYPO_DOMAINS); undefined otherwise. */
export function typoCorrection(domain: string): string | undefined {
  const key = domain.toLowerCase();
  return Object.prototype.hasOwnProperty.call(EMAIL_TYPO_DOMAINS, key) ? EMAIL_TYPO_DOMAINS[key] : undefined;
}

/** Whether `domain` is a provider known to be right as typed (KNOWN_MAIL_DOMAINS). */
export function isKnownMailDomain(domain: string): boolean {
  return KNOWN_MAIL_DOMAINS.has(domain.toLowerCase());
}

/** Whether `a` and `b` are at most one edit apart: one insertion, deletion, substitution or swap of neighbours. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const diff = a.length - b.length;
  if (Math.abs(diff) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (diff === 0) {
    // Substitution, or a swap of neighbours.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // One extra character in the longer string.
  return diff > 0 ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * The address with its domain corrected, when the domain looks mistyped: on
 * the typo list, or (a hint only) one edit from a popular provider and not a
 * known one itself. Null when there's nothing to suggest. The part before
 * the "@" is kept exactly as typed.
 */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at).trim();
  const domain = emailDomainOf(email);
  if (!domain || !local) return null;
  const listed = typoCorrection(domain);
  if (listed) return `${local}@${listed}`;
  if (isKnownMailDomain(domain) || domain.length < HINT_MIN_LENGTH) return null;
  const match = HINT_TARGETS.find((target) => withinOneEdit(domain, target));
  return match ? `${local}@${match}` : null;
}
