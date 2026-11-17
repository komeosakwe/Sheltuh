import { emailDomainOf, isKnownMailDomain, suggestEmail, typoCorrection } from "@/lib/email-typos";
import { clientIp, clientKey } from "./client-key";
import type { Deps } from "./deps";
import { HttpError, type RateWindow } from "./http";

/**
 * Buyer email checks beyond the format (docs/architecture.md, "Buyer email
 * checks"), for every checkout email (paid and free, general admission and
 * seated) and every new address of an email change. In order, after the
 * format (isPlainEmailAddress) has passed:
 * 1. a domain on the hand-picked typo list (lib/email-typos.ts) is refused,
 *    with the correction, even if it has a mail server (a typo domain's mail
 *    server isn't the buyer's). Admins skip this (`typoList: false`): support
 *    has checked the address with the buyer.
 * 2. a provider known to be right (KNOWN_MAIL_DOMAINS) is accepted as is;
 * 3. anything else is looked up in DNS (Deps.mailDomain): a domain that can't
 *    receive email is refused; a lookup that doesn't answer is accepted.
 * All of it is off with EMAIL_DOMAIN_CHECKS=off (Deps.emailDomainChecks): the
 * format is then the only check. Only the domain is ever looked up; neither
 * the address nor the domain is logged.
 */

/**
 * DNS lookups per client (its keyed IP address, as the checkout limits), on
 * private.take_client_rate_limit. A refused email never reaches the checkout
 * limits, so without this one client could make the server look up any
 * number of domains. Over it, the lookup is skipped and the address accepted
 * (fail open, like a lookup that doesn't answer); so too without a client IP
 * or STRIPE_WEBHOOK_SECRET.
 */
export const EMAIL_DOMAIN_LOOKUP_LIMIT = { bucket: "email_domain_lookups", hits: 30, window: "10 minutes" } as const satisfies {
  bucket: string;
  hits: number;
  window: RateWindow;
};

/** Why an address was refused: `email_typo` (on the typo list) or `email_no_mail` (its domain can't receive email). */
export type EmailDomainRefusal = { code: "email_typo" | "email_no_mail"; suggestion?: string };

/** The 400's messages. They never repeat the address (the suggestion travels in its own field). */
export const EMAIL_TYPO_MESSAGE = "That email address looks mistyped. Check the part after the @.";
export const EMAIL_NO_MAIL_MESSAGE = "That email address can't receive email. Check the part after the @.";

/** One hit on the client's lookup allowance: false when it's used up. True (fails open) without a client IP or the secret. */
async function takeLookupAllowance(req: Request, deps: Deps): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return true;
  let secret: string;
  try {
    secret = deps.stripeWebhookSecret();
  } catch {
    return true;
  }
  const [row] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [clientKey(ip, secret), EMAIL_DOMAIN_LOOKUP_LIMIT.bucket, EMAIL_DOMAIN_LOOKUP_LIMIT.hits, EMAIL_DOMAIN_LOOKUP_LIMIT.window],
  );
  return row.allowed;
}

function withDomain(email: string, domain: string): string {
  return `${email.slice(0, email.lastIndexOf("@"))}@${domain}`;
}

/**
 * The refusal for `email` (already a plain address), or null when it's
 * accepted. See the module comment for the order of the checks.
 */
export async function checkEmailDomain(
  req: Request,
  deps: Deps,
  email: string,
  options: { typoList?: boolean } = {},
): Promise<EmailDomainRefusal | null> {
  if (!deps.emailDomainChecks()) return null;
  const domain = emailDomainOf(email);
  if (!domain) return null;
  if (options.typoList !== false) {
    const meant = typoCorrection(domain);
    if (meant) return { code: "email_typo", suggestion: withDomain(email, meant) };
  }
  if (isKnownMailDomain(domain)) return null;
  if (!(await takeLookupAllowance(req, deps))) return null;
  if ((await deps.mailDomain(domain)) !== "no_mail") return null;
  const suggestion = suggestEmail(email);
  return suggestion && suggestion !== email ? { code: "email_no_mail", suggestion } : { code: "email_no_mail" };
}

/**
 * checkEmailDomain, throwing its refusal as a 400: `fieldErrors[field]`, and
 * `code` (`email_typo` / `email_no_mail`) and any `suggestion` (the address
 * with the domain corrected, for the client's "Did you mean …?") in the body.
 */
export async function refuseUndeliverableEmail(
  req: Request,
  deps: Deps,
  email: string,
  field: string,
  options: { typoList?: boolean } = {},
): Promise<void> {
  const refusal = await checkEmailDomain(req, deps, email, options);
  if (!refusal) return;
  const message = refusal.code === "email_typo" ? EMAIL_TYPO_MESSAGE : EMAIL_NO_MAIL_MESSAGE;
  throw new HttpError(400, message, { [field]: message }, { ...refusal });
}
