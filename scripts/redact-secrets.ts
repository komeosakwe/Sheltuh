/**
 * Pattern-based redaction for what the command-line scripts print
 * (scripts/payment-domains.ts, scripts/apple-client-secret.ts). A secret
 * pasted in the wrong place can turn up anywhere a script echoes its input
 * (an "unknown argument" or "isn't a valid hostname" message), so:
 *
 *   - every line those scripts print goes through `redactSecrets`;
 *   - an argument that `looksSecret` is refused before anything else, with
 *     ROTATE_ADVICE instead of the argument;
 *   - any other argument is only echoed through `showArg`: quoted when it's
 *     at most MAX_ECHO_LENGTH characters, otherwise described by its length.
 *
 * What counts as a secret:
 *   - Stripe API keys: sk_/rk_/pk_ + test|live, masked forms included
 *     (`sk_live_****1234`, `rk_test_…abcd`), and webhook secrets (whsec_…).
 *   - PEM private-key blocks (`-----BEGIN … PRIVATE KEY-----` to the END
 *     line, or to the end of the text if that's missing).
 *   - Long base64 runs, which is what a .p8 key's body looks like without its
 *     BEGIN/END lines. In printed text: 32+ base64 characters mixing upper-
 *     and lower-case letters and digits, with a "+" or a 16+ character mixed
 *     stretch between slashes (so most file paths print as they are; one
 *     that's caught only loses that part of the path). As an argument: the
 *     whole value (after `--flag=`, if any) is 32+ base64 characters, line
 *     breaks allowed, mixing upper- and lower-case letters and digits. A file
 *     path rarely matches that (it almost always has a "." or "_"), so real
 *     paths aren't refused.
 *
 * Patterns can miss a secret in an unexpected format, so the scripts also
 * never echo long arguments at all. Kept free of process/env so
 * tests/redact-secrets.test.ts can test it directly.
 */

export const REDACTED = "[redacted]";

/** Arguments longer than this are never echoed back, whatever they contain. */
export const MAX_ECHO_LENGTH = 64;

/** Printed (once) instead of an argument that looks like a key. */
export const ROTATE_ADVICE =
  "An argument looks like a secret key (a Stripe key, webhook secret or private key), so it isn't shown and nothing was run. " +
  "If it was a real key, treat it as exposed (it may be in your shell history or terminal scrollback) and rotate it.";

const STRIPE_KEY = /(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*•…]*/g;
const WEBHOOK_SECRET = /whsec_[A-Za-z0-9*•…+/=]*/g;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
// A PEM boundary on its own, e.g. one word of an unquoted `$(cat AuthKey.p8)`.
const PEM_BOUNDARY = /-----(?:BEGIN|END)\b|\bKEY-----/;
const BASE64_RUN = /[A-Za-z0-9+/]{32,}={0,2}/g;
const BASE64_VALUE = /^[A-Za-z0-9+/]{32,}={0,2}$/;

function mixesClasses(text: string): boolean {
  return /[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text);
}

function isKeyLikeRun(run: string): boolean {
  if (!mixesClasses(run)) return false;
  if (run.includes("+")) return true;
  return run.split("/").some((piece) => {
    const bare = piece.replace(/=+$/, "");
    return bare.length >= 16 && mixesClasses(bare);
  });
}

/** `text` with anything key-shaped replaced by [redacted]. */
export function redactSecrets(text: string): string {
  return text
    .replace(PEM_PRIVATE_KEY, REDACTED)
    .replace(STRIPE_KEY, REDACTED)
    .replace(WEBHOOK_SECRET, REDACTED)
    .replace(BASE64_RUN, (run) => (isKeyLikeRun(run) ? REDACTED : run));
}

function isBase64Value(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return BASE64_VALUE.test(compact) && mixesClasses(compact);
}

/**
 * Whether a command-line argument looks like a key: it holds a Stripe key,
 * webhook secret, PEM private key or PEM boundary, or it (or its value after
 * `--flag=`) is a base64 blob.
 */
export function looksSecret(arg: string): boolean {
  // Reset the shared /g patterns' state by testing fresh copies.
  if ([STRIPE_KEY, WEBHOOK_SECRET, PEM_PRIVATE_KEY].some((pattern) => new RegExp(pattern.source).test(arg))) return true;
  if (PEM_BOUNDARY.test(arg)) return true;
  if (isBase64Value(arg)) return true;
  const eq = arg.indexOf("=");
  return arg.startsWith("-") && eq !== -1 && isBase64Value(arg.slice(eq + 1));
}

/** Whether an argument may be echoed back as it is: not key-like, and at most MAX_ECHO_LENGTH characters. */
export function echoable(arg: string): boolean {
  return arg.length <= MAX_ECHO_LENGTH && !looksSecret(arg);
}

/**
 * An argument as it's safe to echo: quoted, or a description of it (never the
 * argument) when it's key-like or longer than MAX_ECHO_LENGTH.
 */
export function showArg(arg: string): string {
  if (looksSecret(arg)) return "an argument that looks like a secret key (not shown)";
  if (arg.length > MAX_ECHO_LENGTH) return `an argument of ${arg.length} characters (not shown)`;
  return `"${arg}"`;
}

/** Wraps a print function so every line it's given is redacted first. */
export function redacting(print: (line: string) => void): (line: string) => void {
  return (line) => print(redactSecrets(line));
}
