/**
 * The logic behind `npm run payment-domains` (scripts/register-payment-domains.ts):
 * checks, and with --register sets up, the Stripe payment method domains
 * that Apple Pay, Google Pay and Link need before they appear in the
 * embedded Checkout form on /checkout/pay. Stripe's types say a method
 * "doesn't appear in Elements or Embedded Checkout for this domain until it
 * is active".
 *
 * Kept free of process/env/network so tests/payment-domains.test.ts can run
 * it against a fake Stripe client. The key's value is never printed: only the
 * environment variable it came from and its kind (secret or restricted, test
 * or live), and any Stripe error message is redacted before it's printed.
 */
import type Stripe from "stripe";

/** The key the script prefers: a restricted key made for this job. */
export const DOMAINS_KEY_ENV = "STRIPE_DOMAINS_KEY";
/** Its fallback: the app's own secret key (e.g. from .env.local). */
export const FALLBACK_KEY_ENV = "STRIPE_SECRET_KEY";

/** The payment methods Sheltüh offers that need the domain. The others (PayPal, Klarna, Amazon Pay) stay off. */
export const WALLETS = ["apple_pay", "google_pay", "link"] as const;
type Wallet = (typeof WALLETS)[number];
const WALLET_NAMES: Record<Wallet, string> = { apple_pay: "Apple Pay", google_pay: "Google Pay", link: "Link" };

export type PaymentMethodDomain = Pick<
  Stripe.PaymentMethodDomain,
  "id" | "domain_name" | "enabled" | "livemode" | "apple_pay" | "google_pay" | "link"
>;

/** The slice of `stripe.paymentMethodDomains` the script uses. */
export interface PaymentMethodDomainsClient {
  list(params: { domain_name: string; limit: number }): PromiseLike<{ data: PaymentMethodDomain[] }>;
  create(params: { domain_name: string; enabled: boolean }): PromiseLike<PaymentMethodDomain>;
  update(id: string, params: { enabled: boolean }): PromiseLike<PaymentMethodDomain>;
  validate(id: string): PromiseLike<PaymentMethodDomain>;
}

// ---------------------------------------------------------------------------
// Hostnames
// ---------------------------------------------------------------------------

export type HostnameCheck = { ok: true; hostname: string } | { ok: false; reason: string };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EXAMPLE = "e.g. app.sheltuh.com.au";

/**
 * A bare public hostname, lowercased. Refuses a scheme, path, query, user
 * info, port, wildcard, IP address, localhost, a trailing dot, non-ASCII
 * letters (give the punycode form) and anything else that isn't a valid
 * multi-label hostname: Stripe registers exactly the hostname the payment
 * page is served from, and wallets need a public HTTPS domain.
 */
export function parseHostname(raw: string): HostnameCheck {
  const value = raw.trim().toLowerCase();
  const bad = (why: string): HostnameCheck => ({ ok: false, reason: `"${raw}" ${why}` });
  if (!value) return { ok: false, reason: "An empty hostname was given." };
  if (value.includes("://")) return bad(`has a scheme: give the hostname only (${EXAMPLE}).`);
  if (/[/?#\\]/.test(value)) return bad(`has a path or query: give the hostname only (${EXAMPLE}).`);
  if (value.includes("@")) return bad(`has user info: give the hostname only (${EXAMPLE}).`);
  if (value.includes("*")) return bad("is a wildcard: Stripe registers each hostname on its own.");
  if (value.startsWith("[") || (value.match(/:/g) ?? []).length > 1) return bad("is an IP address: give a domain name.");
  if (value.includes(":")) return bad("has a port: give the hostname only.");
  if (value.endsWith(".")) return bad("ends with a dot: drop it.");
  if (/[^\x21-\x7e]/.test(value)) return bad("has spaces or non-ASCII letters: give its punycode (xn--…) form.");
  const labels = value.split(".");
  const tld = labels[labels.length - 1];
  if (tld === "localhost") return bad("is localhost: wallets need a public HTTPS domain.");
  if (/^[0-9]+$/.test(tld)) return bad("is an IP address: give a domain name.");
  if (labels.length < 2) return bad(`isn't a full hostname (${EXAMPLE}).`);
  if (value.length > 253 || !labels.every((label) => LABEL.test(label))) return bad("isn't a valid hostname.");
  return { ok: true, hostname: value };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type KeyInfo = { mode: "test" | "live"; restricted: boolean };

/** The kind of Stripe key, from its prefix only: sk_ (secret) or rk_ (restricted), test or live. */
export function describeKey(key: string): KeyInfo | undefined {
  const match = /^(sk|rk)_(test|live)_/.exec(key);
  if (!match) return undefined;
  return { mode: match[2] as KeyInfo["mode"], restricted: match[1] === "rk" };
}

/** Removes the key, and anything shaped like a Stripe key (masked ones too), from text about to be printed. */
export function redact(text: string, key: string): string {
  const withoutKey = key ? text.split(key).join("[redacted]") : text;
  return withoutKey.replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+/g, "[redacted]");
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type Action = "check" | "register";
export type ParsedArgs =
  | { ok: true; action: Action; hostnames: string[] }
  | { ok: true; action: "help" }
  | { ok: false; errors: string[] };

export const USAGE = [
  "Usage:",
  "  npm run payment-domains -- [--check] <hostname> [<hostname>…]   report each domain (the default; changes nothing)",
  "  npm run payment-domains -- --register <hostname> [<hostname>…]  create or re-enable each domain, then validate",
  "",
  `Key: ${DOMAINS_KEY_ENV} (preferred: a restricted key with write access to payment method domains),`,
  `else ${FALLBACK_KEY_ENV}. The key's mode (test or live) picks which account mode is checked;`,
  "run once with each. Exits non-zero unless every domain is enabled with Apple Pay, Google Pay and Link active.",
].join("\n");

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const errors: string[] = [];
  const hostnames: string[] = [];
  let action: Action | undefined;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { ok: true, action: "help" };
    if (arg === "--check" || arg === "--register") {
      const wanted = arg === "--check" ? "check" : "register";
      if (action && action !== wanted) errors.push("Give --check or --register, not both.");
      action = wanted;
      continue;
    }
    if (arg.startsWith("-")) {
      errors.push(`Unknown option ${arg}.`);
      continue;
    }
    const parsed = parseHostname(arg);
    if (!parsed.ok) errors.push(parsed.reason);
    else if (!hostnames.includes(parsed.hostname)) hostnames.push(parsed.hostname);
  }
  if (errors.length === 0 && hostnames.length === 0) errors.push("Give at least one hostname.");
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, action: action ?? "check", hostnames };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type Print = (line: string) => void;

function inactiveWallets(domain: PaymentMethodDomain): Wallet[] {
  return WALLETS.filter((wallet) => domain[wallet].status !== "active");
}

function report(domain: PaymentMethodDomain, key: KeyInfo, secret: string, print: Print): boolean {
  const livemode = domain.livemode ? "live" : "test";
  print(`${domain.domain_name} (${domain.id}, ${livemode} mode)`);
  if (livemode !== key.mode) print(`  warning: the key is a ${key.mode} key but Stripe says this domain is ${livemode}`);
  print(`  enabled: ${domain.enabled ? "yes" : "no"}`);
  for (const wallet of WALLETS) {
    const { status, status_details: details } = domain[wallet];
    const why = status !== "active" && details?.error_message ? ` (${redact(details.error_message, secret)})` : "";
    print(`  ${WALLET_NAMES[wallet]}: ${status}${why}`);
  }
  return domain.enabled && inactiveWallets(domain).length === 0;
}

async function findDomain(client: PaymentMethodDomainsClient, hostname: string): Promise<PaymentMethodDomain | undefined> {
  const { data } = await client.list({ domain_name: hostname, limit: 10 });
  return data.find((domain) => domain.domain_name.toLowerCase() === hostname);
}

async function registerDomain(client: PaymentMethodDomainsClient, hostname: string, print: Print): Promise<PaymentMethodDomain> {
  let domain = await findDomain(client, hostname);
  if (!domain) {
    domain = await client.create({ domain_name: hostname, enabled: true });
    print(`${hostname}: registered`);
  } else if (!domain.enabled) {
    domain = await client.update(domain.id, { enabled: true });
    print(`${hostname}: re-enabled`);
  }
  const inactive = inactiveWallets(domain);
  if (inactive.length > 0) {
    print(`${hostname}: validating (${inactive.map((wallet) => WALLET_NAMES[wallet]).join(", ")} not active)`);
    domain = await client.validate(domain.id);
  }
  return domain;
}

export type RunOptions = {
  client: PaymentMethodDomainsClient;
  action: Action;
  hostnames: readonly string[];
  /** The key the client was made with: only its kind is printed, and it's redacted from any error. */
  key: string;
  print: Print;
};

/** Checks or registers each hostname; resolves to the process exit code (0 only if every domain is ready). */
export async function runPaymentDomains({ client, action, hostnames, key, print }: RunOptions): Promise<number> {
  const keyInfo = describeKey(key);
  if (!keyInfo) {
    print("The key isn't a Stripe secret (sk_…) or restricted (rk_…) key.");
    return 1;
  }
  const problems: string[] = [];
  for (const hostname of hostnames) {
    try {
      const domain = action === "register" ? await registerDomain(client, hostname, print) : await findDomain(client, hostname);
      if (!domain) {
        print(`${hostname}: not registered in ${keyInfo.mode} mode`);
        problems.push(hostname);
        continue;
      }
      if (!report(domain, keyInfo, key, print)) problems.push(hostname);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      print(`${hostname}: Stripe refused the request: ${redact(message, key)}`);
      problems.push(hostname);
    }
  }
  if (problems.length === 0) {
    print(`All ${hostnames.length} domain(s) ready in ${keyInfo.mode} mode: enabled, with Apple Pay, Google Pay and Link active.`);
    return 0;
  }
  print(`Not ready in ${keyInfo.mode} mode: ${problems.join(", ")}.`);
  print(
    action === "check"
      ? "Run again with --register to create, re-enable or validate them, or see Stripe → Settings → Payment method domains."
      : "Follow the error message above (Stripe → Settings → Payment method domains), then run --register again.",
  );
  return 1;
}

export type MainOptions = {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  makeClient: (key: string) => PaymentMethodDomainsClient;
  print: Print;
  printError: Print;
};

/** The whole command: arguments, the key from the environment, then runPaymentDomains. Resolves to the exit code. */
export async function main({ argv, env, makeClient, print, printError }: MainOptions): Promise<number> {
  const args = parseArgs(argv);
  if (args.ok && args.action === "help") {
    print(USAGE);
    return 0;
  }
  if (!args.ok) {
    for (const error of args.errors) printError(error);
    printError(USAGE);
    return 1;
  }
  const keyEnv = env[DOMAINS_KEY_ENV] ? DOMAINS_KEY_ENV : FALLBACK_KEY_ENV;
  const key = env[keyEnv] ?? "";
  if (!key) {
    printError(`Missing ${DOMAINS_KEY_ENV} (or ${FALLBACK_KEY_ENV}). See docs/supabase-setup.md (Stripe).`);
    return 1;
  }
  const keyInfo = describeKey(key);
  if (!keyInfo) {
    printError(`${keyEnv} isn't a Stripe secret (sk_…) or restricted (rk_…) key.`);
    return 1;
  }
  print(`Using ${keyEnv}: a ${keyInfo.restricted ? "restricted" : "secret"} ${keyInfo.mode}-mode key.`);
  if (!keyInfo.restricted) {
    print("  A restricted key (rk_…) allowed only payment method domains is safer for this; see docs/supabase-setup.md.");
  }
  try {
    return await runPaymentDomains({ client: makeClient(key), action: args.action, hostnames: args.hostnames, key, print });
  } catch (err) {
    printError(redact(err instanceof Error ? err.message : String(err), key));
    return 1;
  }
}
