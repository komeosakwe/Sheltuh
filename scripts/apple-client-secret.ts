/**
 * The logic behind `npm run apple-client-secret`
 * (scripts/generate-apple-client-secret.ts): signs the client secret that
 * Supabase Auth's Apple provider needs ("Secret Key (for OAuth)",
 * docs/supabase-setup.md, "Sign in with Google and Apple").
 *
 * Apple's client secret is a JWT signed with the Sign in with Apple key
 * (the AuthKey_<KeyID>.p8 file, an EC P-256 private key): header
 * `{alg: "ES256", kid: <Key ID>}`, claims `iss` = Team ID, `iat`, `exp`
 * (at most 15,777,000 seconds, about 6 months, after `iat`),
 * `aud` = https://appleid.apple.com and `sub` = the Services ID. It's signed
 * here with node:crypto alone (ES256 = ECDSA P-256 + SHA-256, the signature
 * as raw r‖s: `dsaEncoding: "ieee-p1363"`), so no JWT dependency.
 *
 * Kept free of process/fs so tests/apple-client-secret.test.ts can run it
 * with a key it generates. The key is never printed, and neither is anything
 * read from its file: a key that can't be used gets a message naming only
 * the path. Every stderr line goes through the shared redactor
 * (scripts/redact-secrets.ts), and arguments are only echoed when short and
 * not key-like, so a .p8 key pasted as an argument by mistake is never
 * printed: the script says one was spotted and advises rotating it instead.
 * stdout carries only the signed JWT (the script's output, meant to be
 * copied), so it isn't redacted.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { echoable, looksSecret, redacting, ROTATE_ADVICE, showArg } from "./redact-secrets";

/** Apple's limit on `exp - iat`: 15,777,000 seconds (about 182.6 days). */
export const MAX_LIFETIME_SECONDS = 15_777_000;
/** The longest whole-day lifetime under that limit. */
export const MAX_DAYS = Math.floor(MAX_LIFETIME_SECONDS / 86_400); // 182
/** The default: 180 days, leaving a margin under the limit. Rotate at about 5 months. */
export const DEFAULT_DAYS = 180;

export const APPLE_AUDIENCE = "https://appleid.apple.com";

// Apple's Team IDs and Key IDs are 10 upper-case letters and digits.
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;
// A Services ID is a reverse-domain identifier, e.g. au.com.sheltuh.web.
const SERVICES_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export const USAGE = [
  "Usage:",
  "  npm run apple-client-secret -- --key <path/to/AuthKey_KEYID.p8> --team-id <TEAMID> \\",
  "    --key-id <KEYID> --services-id <services.id> [--days <1-182>]",
  "",
  `Prints the client secret JWT for Supabase's Apple provider, valid for --days (default ${DEFAULT_DAYS},`,
  `at most ${MAX_DAYS}: Apple's limit is ${MAX_LIFETIME_SECONDS.toLocaleString("en-AU")} seconds), and when it expires.`,
  "The .p8 key is only read, never printed. Keep it outside the repo.",
].join("\n");

export interface SecretOptions {
  keyPath: string;
  teamId: string;
  keyId: string;
  servicesId: string;
  days: number;
}

export type ParsedArgs = { ok: true; options: SecretOptions } | { ok: false; help?: true; reason: string };

const FLAGS = {
  "--key": "keyPath",
  "--team-id": "teamId",
  "--key-id": "keyId",
  "--services-id": "servicesId",
  "--days": "days",
} as const;
type Flag = keyof typeof FLAGS;

function isFlag(value: string): value is Flag {
  return Object.hasOwn(FLAGS, value);
}

/** `--flag value` or `--flag=value`; every flag but --days is required. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values: Partial<Record<(typeof FLAGS)[Flag], string>> = {};
  // A key pasted in the wrong place (e.g. the .p8's contents instead of its path): refused first, never echoed.
  if (argv.some(looksSecret)) return { ok: false, reason: ROTATE_ADVICE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ok: false, help: true, reason: USAGE };
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!isFlag(name)) {
      return { ok: false, reason: echoable(name) ? `Unknown argument "${name}".` : `Unknown argument: ${showArg(name)}.` };
    }
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      return { ok: false, reason: `${name} needs a value.` };
    }
    const key = FLAGS[name];
    if (values[key] !== undefined) return { ok: false, reason: `${name} was given twice.` };
    values[key] = value;
  }

  const missing = (Object.keys(FLAGS) as Flag[]).filter((flag) => flag !== "--days" && values[FLAGS[flag]] === undefined);
  if (missing.length > 0) return { ok: false, reason: `Missing ${missing.join(", ")}.` };

  const teamId = values.teamId as string;
  const keyId = values.keyId as string;
  const servicesId = values.servicesId as string;
  if (!APPLE_ID_PATTERN.test(teamId)) {
    return { ok: false, reason: "--team-id should be your 10-character Apple Team ID (Membership details)." };
  }
  if (!APPLE_ID_PATTERN.test(keyId)) {
    return { ok: false, reason: "--key-id should be the key's 10-character Key ID (Certificates, IDs & Profiles → Keys)." };
  }
  if (servicesId.length > 255 || !SERVICES_ID_PATTERN.test(servicesId)) {
    return { ok: false, reason: "--services-id should be the Services ID's identifier, e.g. au.com.sheltuh.web." };
  }

  let days = DEFAULT_DAYS;
  if (values.days !== undefined) {
    if (!/^\d+$/.test(values.days)) return { ok: false, reason: "--days should be a whole number of days." };
    days = Number(values.days);
    if (days < 1) return { ok: false, reason: "--days should be at least 1." };
    if (days * 86_400 > MAX_LIFETIME_SECONDS) {
      return {
        ok: false,
        reason: `--days ${days} is over Apple's limit of ${MAX_LIFETIME_SECONDS.toLocaleString("en-AU")} seconds; use at most ${MAX_DAYS}.`,
      };
    }
  }

  return { ok: true, options: { keyPath: values.keyPath as string, teamId, keyId, servicesId, days } };
}

/** Thrown with a message that's safe to print: it never contains the key or its file's contents. */
export class SecretError extends Error {}

/**
 * The signing key from a .p8 file's contents: an unencrypted EC P-256
 * private key (Apple's PKCS #8 PEM). Anything else is refused with a message
 * naming only `label` (the path), never the contents or the parser's error.
 */
export function loadSigningKey(pem: string, label: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new SecretError(`${label} isn't a readable private key. Use the AuthKey_<KeyID>.p8 file Apple gave you, unchanged.`);
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new SecretError(`${label} isn't an EC P-256 key. Use the Sign in with Apple key (AuthKey_<KeyID>.p8).`);
  }
  return key;
}

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

export interface SecretInput {
  key: KeyObject;
  teamId: string;
  keyId: string;
  servicesId: string;
  /** Unix seconds. */
  issuedAt: number;
  lifetimeSeconds: number;
}

/** The signed client secret and when it stops working. Refuses a lifetime over Apple's limit. */
export function buildAppleClientSecret(input: SecretInput): { jwt: string; expiresAt: Date } {
  const { key, teamId, keyId, servicesId, issuedAt, lifetimeSeconds } = input;
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) throw new SecretError("issuedAt must be whole Unix seconds.");
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1) {
    throw new SecretError("The lifetime must be a whole number of seconds, at least 1.");
  }
  if (lifetimeSeconds > MAX_LIFETIME_SECONDS) {
    throw new SecretError(`The lifetime is over Apple's limit of ${MAX_LIFETIME_SECONDS} seconds.`);
  }
  const exp = issuedAt + lifetimeSeconds;
  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: issuedAt, exp, aud: APPLE_AUDIENCE, sub: servicesId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return { jwt: `${signingInput}.${base64url(signature)}`, expiresAt: new Date(exp * 1000) };
}

export interface MainIo {
  argv: readonly string[];
  /** Reads the .p8 file as text. */
  readFile: (path: string) => string;
  now: () => Date;
  /** stdout: the JWT alone, so it can be piped to the clipboard. */
  print: (line: string) => void;
  /** stderr: the expiry, usage and errors. */
  printError: (line: string) => void;
}

/** Runs the script; the exit code. */
export function main(io: MainIo): number {
  const printError = redacting(io.printError);
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) {
    printError(parsed.reason);
    if (!parsed.help) printError(`\n${USAGE}`);
    return parsed.help ? 0 : 1;
  }
  const { keyPath, teamId, keyId, servicesId, days } = parsed.options;
  try {
    let pem: string;
    try {
      pem = io.readFile(keyPath);
    } catch {
      throw new SecretError(`Couldn't read ${keyPath}.`);
    }
    const key = loadSigningKey(pem, keyPath);
    const { jwt, expiresAt } = buildAppleClientSecret({
      key,
      teamId,
      keyId,
      servicesId,
      issuedAt: Math.floor(io.now().getTime() / 1000),
      lifetimeSeconds: days * 86_400,
    });
    io.print(jwt);
    printError(
      `Expires ${expiresAt.toISOString()} (${days} days). Paste it into Supabase → Authentication → ` +
        "Sign In / Providers → Apple → Secret Key (for OAuth), and rotate it before then (about 5 months).",
    );
    return 0;
  } catch (err) {
    printError(err instanceof SecretError ? err.message : "Couldn't sign the client secret.");
    return 1;
  }
}
