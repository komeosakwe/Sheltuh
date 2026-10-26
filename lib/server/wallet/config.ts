import { createPrivateKey, X509Certificate, type KeyObject } from "node:crypto";

/**
 * Wallet pass configuration (docs/architecture.md, "Wallet passes";
 * docs/wallet-setup.md). Each provider is on only when every one of its
 * server-only variables is set and valid; otherwise it's off, and the API
 * neither offers its button (CustomerOrder.wallet) nor serves its passes
 * (404). Nothing else needs changing: adding the variables in Vercel and
 * redeploying turns a provider on.
 *
 * The only module that reads these variables. A value is never logged or
 * put in an error message: a problem is reported by the variable's name
 * only (`problems`), and the caller logs that once. Only node:crypto here
 * (Deps loads this module for every route); node-forge is imported by the
 * Apple pass builder alone (./apple.ts), so only the wallet routes bundle it.
 */

export interface GoogleWalletConfig {
  issuerId: string;
  serviceAccountEmail: string;
  /** The service account's RSA private key, parsed (the JWT's RS256 signing key). */
  privateKey: KeyObject;
}

export interface AppleWalletConfig {
  passTypeId: string;
  teamId: string;
  /** The Pass Type ID certificate (PEM), its private key (decrypted, parsed), and Apple's WWDR intermediate (PEM). */
  signerCertPem: string;
  signerKey: KeyObject;
  wwdrCertPem: string;
  /** When the Pass Type ID certificate expires (ms since the epoch): passes are off from then. */
  certExpiresAt: number;
}

export type ConfigResult<T> = { config: T } | { problems: string[] };

/** A Google Wallet issuer ID: digits only (Google's are 19). */
const ISSUER_ID_PATTERN = /^\d{1,30}$/;
/** A Google Cloud service account's address (…@<project>.iam.gserviceaccount.com, or an older …gserviceaccount.com one). */
const SERVICE_ACCOUNT_PATTERN = /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.gserviceaccount\.com$/i;
/** Apple's Pass Type ID: `pass.` and a reverse-DNS name. */
const PASS_TYPE_ID_PATTERN = /^pass(\.[A-Za-z0-9-]+)+$/;
/** An Apple Developer Team ID: 10 upper-case letters and digits. */
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

const env = (values: Record<string, string | undefined>, name: string) => values[name]?.trim() || undefined;

/**
 * A PEM as Vercel may store it: surrounding quotes (pasted from the JSON key
 * file) dropped, and literal `\n` escapes turned into newlines.
 */
export function normalisePem(value: string): string {
  let pem = value.trim();
  if (pem.length >= 2 && pem.startsWith('"') && pem.endsWith('"')) pem = pem.slice(1, -1);
  return pem.replace(/\\r\\n|\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}

/** A base64-encoded PEM (the Apple variables), or a raw PEM pasted as is; undefined if it's neither. */
export function decodePemVariable(value: string): string | undefined {
  const raw = normalisePem(value);
  if (raw.startsWith("-----BEGIN ")) return raw;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return undefined;
  const decoded = normalisePem(Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8"));
  return decoded.startsWith("-----BEGIN ") ? decoded : undefined;
}

function rsaKey(pem: string, passphrase?: string): KeyObject | undefined {
  try {
    const key = createPrivateKey({ key: pem, format: "pem", ...(passphrase ? { passphrase } : {}) });
    if (key.asymmetricKeyType !== "rsa") return undefined;
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return undefined;
    return key;
  } catch {
    return undefined;
  }
}

/**
 * GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL and
 * GOOGLE_WALLET_PRIVATE_KEY (the key file's `private_key`, a PKCS #8 PEM;
 * literal `\n` escapes and surrounding quotes are accepted). All three unset
 * is plainly off (no problem reported).
 */
export function googleWalletConfigFromEnv(values: Record<string, string | undefined> = process.env): ConfigResult<GoogleWalletConfig> {
  const issuerId = env(values, "GOOGLE_WALLET_ISSUER_ID");
  const serviceAccountEmail = env(values, "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL");
  const keyValue = env(values, "GOOGLE_WALLET_PRIVATE_KEY");
  if (!issuerId && !serviceAccountEmail && !keyValue) return { problems: [] };

  const problems: string[] = [];
  if (!issuerId) problems.push("GOOGLE_WALLET_ISSUER_ID isn't set");
  else if (!ISSUER_ID_PATTERN.test(issuerId)) problems.push("GOOGLE_WALLET_ISSUER_ID isn't an issuer ID (digits only)");
  if (!serviceAccountEmail) problems.push("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL isn't set");
  else if (!SERVICE_ACCOUNT_PATTERN.test(serviceAccountEmail)) {
    problems.push("GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL isn't a service account address (…gserviceaccount.com)");
  }
  const privateKey = keyValue ? rsaKey(normalisePem(keyValue)) : undefined;
  if (!keyValue) problems.push("GOOGLE_WALLET_PRIVATE_KEY isn't set");
  else if (!privateKey) problems.push("GOOGLE_WALLET_PRIVATE_KEY isn't an RSA private key in PEM (2048 bits or more)");

  if (problems.length > 0 || !issuerId || !serviceAccountEmail || !privateKey) return { problems };
  return { config: { issuerId, serviceAccountEmail, privateKey } };
}

/** The value of `attribute` (e.g. "UID", "OU") in a certificate's subject, if it has one. */
function subjectAttribute(cert: X509Certificate, attribute: string): string | undefined {
  const line = cert.subject.split("\n").find((part) => part.startsWith(`${attribute}=`));
  return line?.slice(attribute.length + 1);
}

function certificate(pem: string): X509Certificate | undefined {
  try {
    return new X509Certificate(pem);
  } catch {
    return undefined;
  }
}

/**
 * APPLE_WALLET_PASS_TYPE_ID, APPLE_WALLET_TEAM_ID, APPLE_WALLET_CERT_PEM,
 * APPLE_WALLET_KEY_PEM, APPLE_WALLET_WWDR_PEM (the three PEMs base64-encoded,
 * or pasted raw) and the optional APPLE_WALLET_KEY_PASSPHRASE. Checked: the
 * certificate is current, the key is its key, Apple's intermediate issued
 * it, and its subject names this Pass Type ID and team (when it names them
 * at all, as Apple's do). All unset is plainly off (no problem reported).
 */
export function appleWalletConfigFromEnv(
  values: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): ConfigResult<AppleWalletConfig> {
  const passTypeId = env(values, "APPLE_WALLET_PASS_TYPE_ID");
  const teamId = env(values, "APPLE_WALLET_TEAM_ID");
  const certValue = env(values, "APPLE_WALLET_CERT_PEM");
  const keyValue = env(values, "APPLE_WALLET_KEY_PEM");
  const wwdrValue = env(values, "APPLE_WALLET_WWDR_PEM");
  // Not trimmed: a passphrase may have spaces. Empty means none.
  const passphrase = values.APPLE_WALLET_KEY_PASSPHRASE || undefined;
  if (!passTypeId && !teamId && !certValue && !keyValue && !wwdrValue) return { problems: [] };

  const problems: string[] = [];
  if (!passTypeId) problems.push("APPLE_WALLET_PASS_TYPE_ID isn't set");
  else if (!PASS_TYPE_ID_PATTERN.test(passTypeId)) problems.push("APPLE_WALLET_PASS_TYPE_ID isn't a Pass Type ID (pass.…)");
  if (!teamId) problems.push("APPLE_WALLET_TEAM_ID isn't set");
  else if (!TEAM_ID_PATTERN.test(teamId)) problems.push("APPLE_WALLET_TEAM_ID isn't a Team ID (10 letters and digits)");

  const certPem = certValue ? decodePemVariable(certValue) : undefined;
  const cert = certPem ? certificate(certPem) : undefined;
  if (!certValue) problems.push("APPLE_WALLET_CERT_PEM isn't set");
  else if (!cert) problems.push("APPLE_WALLET_CERT_PEM isn't a base64-encoded PEM certificate");

  const keyPem = keyValue ? decodePemVariable(keyValue) : undefined;
  const key = keyPem ? rsaKey(keyPem, passphrase) : undefined;
  if (!keyValue) problems.push("APPLE_WALLET_KEY_PEM isn't set");
  else if (!key) {
    problems.push("APPLE_WALLET_KEY_PEM isn't a base64-encoded PEM RSA private key (or APPLE_WALLET_KEY_PASSPHRASE is wrong or missing)");
  }

  const wwdrPem = wwdrValue ? decodePemVariable(wwdrValue) : undefined;
  const wwdr = wwdrPem ? certificate(wwdrPem) : undefined;
  if (!wwdrValue) problems.push("APPLE_WALLET_WWDR_PEM isn't set");
  else if (!wwdr) problems.push("APPLE_WALLET_WWDR_PEM isn't a base64-encoded PEM certificate");

  if (cert) {
    if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) {
      problems.push("APPLE_WALLET_CERT_PEM isn't valid now (expired, or not yet valid)");
    }
    if (key && !cert.checkPrivateKey(key)) problems.push("APPLE_WALLET_KEY_PEM isn't the private key of APPLE_WALLET_CERT_PEM");
    if (wwdr && !(cert.checkIssued(wwdr) && cert.verify(wwdr.publicKey))) {
      problems.push("APPLE_WALLET_WWDR_PEM didn't issue APPLE_WALLET_CERT_PEM (use Apple's WWDR G4 intermediate)");
    }
    const uid = subjectAttribute(cert, "UID");
    if (passTypeId && uid !== undefined && uid !== passTypeId) {
      problems.push("APPLE_WALLET_CERT_PEM is for another Pass Type ID than APPLE_WALLET_PASS_TYPE_ID");
    }
    const ou = subjectAttribute(cert, "OU");
    if (teamId && ou !== undefined && ou !== teamId) problems.push("APPLE_WALLET_CERT_PEM is for another team than APPLE_WALLET_TEAM_ID");
  }
  if (wwdr && Date.parse(wwdr.validTo) <= now) problems.push("APPLE_WALLET_WWDR_PEM has expired");

  if (problems.length > 0 || !passTypeId || !teamId || !cert || !key || !wwdr || !certPem || !wwdrPem) return { problems };
  return {
    config: { passTypeId, teamId, signerCertPem: certPem, signerKey: key, wwdrCertPem: wwdrPem, certExpiresAt: Date.parse(cert.validTo) },
  };
}

/**
 * Reads a provider's configuration and logs why it's off (names only), for
 * Deps, which calls it once. `label` is "Google Wallet" or "Apple Wallet".
 * Never throws: whatever goes wrong reading it, the wallet is just off, so
 * the ticket page (which asks for the flags) can't break over it.
 */
export function loadWalletConfig<T>(label: string, read: () => ConfigResult<T>): T | undefined {
  let result: ConfigResult<T>;
  try {
    result = read();
  } catch {
    console.error(`${label} passes are off: its configuration couldn't be read.`);
    return undefined;
  }
  if (!("problems" in result)) return result.config;
  if (result.problems.length > 0) console.error(`${label} passes are off: ${result.problems.join("; ")}.`);
  return undefined;
}
