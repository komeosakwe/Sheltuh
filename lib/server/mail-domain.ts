import { Resolver } from "node:dns/promises";

/**
 * Whether a domain can receive email, by DNS (docs/architecture.md, "Buyer
 * email checks"): Deps.mailDomain. Only the domain is ever looked up, never
 * the address, and nothing is logged.
 *
 * - `accepts`: it has a mail server (MX), or no MX but an address (A/AAAA),
 *   which mail falls back to (RFC 5321 §5.1).
 * - `no_mail`: the domain doesn't exist (NXDOMAIN), says it takes no mail (a
 *   "null MX", RFC 7505), or has neither MX nor address records.
 * - `unknown`: DNS didn't answer in time or failed. Treated as accepted
 *   (fail open): a slow resolver must never block a checkout.
 */
export type MailDomainAnswer = "accepts" | "no_mail" | "unknown";

/** The resolver calls a lookup makes: node:dns/promises' Resolver, or a test's stub. */
export interface MailResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
  /** Abandons the resolver's outstanding queries (they reject with ECANCELLED). */
  cancel(): void;
}

export const MAIL_DOMAIN_LOOKUP = {
  /** Each DNS query: one try of 1.5 seconds. */
  queryTimeoutMs: 1_500,
  /** The whole lookup (the MX query, then A and AAAA together): past this it's `unknown`. */
  totalTimeoutMs: 2_500,
  /** How long a definite answer (`accepts`, `no_mail`) is reused for, per domain. */
  cacheTtlMs: 10 * 60_000,
  /** Domains remembered at most (the oldest goes first). */
  cacheMax: 1_000,
} as const;

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : undefined;
}

/** NXDOMAIN, or the name exists with no records of the type asked for. */
const NOT_THERE = new Set(["ENOTFOUND", "ENODATA"]);

async function lookUp(resolver: MailResolver, domain: string): Promise<MailDomainAnswer> {
  try {
    const records = await resolver.resolveMx(domain);
    if (records.length > 0) {
      // A null MX (RFC 7505) is one record whose exchange is the root (Node reports it as "").
      return records.every((r) => r.exchange === "" || r.exchange === ".") ? "no_mail" : "accepts";
    }
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOTFOUND") return "no_mail";
    if (code !== "ENODATA") return "unknown";
  }
  // No MX: mail goes to the domain's own address, if it has one.
  const answers = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
  if (answers.some((a) => a.status === "fulfilled" && a.value.length > 0)) return "accepts";
  const nothing = answers.every((a) => (a.status === "fulfilled" ? a.value.length === 0 : NOT_THERE.has(errorCode(a.reason) ?? "")));
  return nothing ? "no_mail" : "unknown";
}

/**
 * Deps.mailDomain: a lookup with its own small in-memory cache of definite
 * answers (per server instance; `unknown` is never cached, so a DNS hiccup
 * isn't remembered). `newResolver` makes one resolver per lookup, so a
 * lookup that runs out of time can cancel its own queries.
 */
export function createMailDomainLookup(
  newResolver: () => MailResolver = () => new Resolver({ timeout: MAIL_DOMAIN_LOOKUP.queryTimeoutMs, tries: 1 }),
  now: () => number = Date.now,
): (domain: string) => Promise<MailDomainAnswer> {
  const cache = new Map<string, { answer: MailDomainAnswer; until: number }>();
  return async (rawDomain) => {
    const domain = rawDomain.trim().toLowerCase();
    const cached = cache.get(domain);
    if (cached && cached.until > now()) return cached.answer;
    cache.delete(domain);

    const resolver = newResolver();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<MailDomainAnswer>((resolve) => {
      timer = setTimeout(() => {
        resolver.cancel();
        resolve("unknown");
      }, MAIL_DOMAIN_LOOKUP.totalTimeoutMs);
    });
    let answer: MailDomainAnswer;
    try {
      answer = await Promise.race([lookUp(resolver, domain).catch((): MailDomainAnswer => "unknown"), timedOut]);
    } finally {
      clearTimeout(timer);
    }
    if (answer !== "unknown") {
      if (cache.size >= MAIL_DOMAIN_LOOKUP.cacheMax) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(domain, { answer, until: now() + MAIL_DOMAIN_LOOKUP.cacheTtlMs });
    }
    return answer;
  };
}
