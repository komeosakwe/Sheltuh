import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APPLE_AUDIENCE,
  buildAppleClientSecret,
  DEFAULT_DAYS,
  loadSigningKey,
  main,
  MAX_DAYS,
  MAX_LIFETIME_SECONDS,
  parseArgs,
  SecretError,
  type MainIo,
} from "@/scripts/apple-client-secret";

// A throwaway P-256 key, generated for this run: shaped like Apple's AuthKey_<KeyID>.p8 (PKCS #8 PEM).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PEM_BODY = PEM.split("\n")[1];

const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY9876543";
const SERVICES_ID = "au.com.sheltuh.web";
const KEY_PATH = "/secure/AuthKey_KEY9876543.p8";
const NOW = new Date("2026-10-24T00:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

const ARGS = ["--key", KEY_PATH, "--team-id", TEAM_ID, "--key-id", KEY_ID, "--services-id", SERVICES_ID];

function decode(jwt: string) {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  const [h, c, s] = parts;
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as Record<string, unknown>,
    signingInput: `${h}.${c}`,
    signature: Buffer.from(s, "base64url"),
  };
}

function verifies(jwt: string, key: KeyObject = publicKey): boolean {
  const { signingInput, signature } = decode(jwt);
  return verify("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" }, signature);
}

function run(argv: readonly string[], overrides: Partial<MainIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const reads: string[] = [];
  const code = main({
    argv,
    readFile: (path) => {
      reads.push(path);
      return PEM;
    },
    now: () => NOW,
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
    ...overrides,
  });
  return { code, out, err, reads, all: [...out, ...err].join("\n") };
}

describe("buildAppleClientSecret", () => {
  it("signs Apple's header and claims with ES256 (raw r‖s), verifiable with the public key", () => {
    const key = loadSigningKey(PEM, KEY_PATH);
    const { jwt, expiresAt } = buildAppleClientSecret({
      key,
      teamId: TEAM_ID,
      keyId: KEY_ID,
      servicesId: SERVICES_ID,
      issuedAt: NOW_SECONDS,
      lifetimeSeconds: 3600,
    });
    const { header, claims, signature } = decode(jwt);
    expect(header).toEqual({ alg: "ES256", kid: KEY_ID });
    expect(claims).toEqual({
      iss: TEAM_ID,
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 3600,
      aud: "https://appleid.apple.com",
      sub: SERVICES_ID,
    });
    expect(APPLE_AUDIENCE).toBe("https://appleid.apple.com");
    // JOSE ES256 is the 64-byte r‖s form, not DER.
    expect(signature).toHaveLength(64);
    expect(verifies(jwt)).toBe(true);
    expect(expiresAt.toISOString()).toBe("2026-10-24T01:00:00.000Z");
  });

  it("fails verification with another key or a changed claim", () => {
    const { jwt } = buildAppleClientSecret({
      key: privateKey,
      teamId: TEAM_ID,
      keyId: KEY_ID,
      servicesId: SERVICES_ID,
      issuedAt: NOW_SECONDS,
      lifetimeSeconds: 60,
    });
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;
    expect(verifies(jwt, other)).toBe(false);
    const [h, , s] = jwt.split(".");
    const forged = Buffer.from(JSON.stringify({ iss: TEAM_ID, sub: "evil.example" })).toString("base64url");
    expect(verifies(`${h}.${forged}.${s}`)).toBe(false);
  });

  it("allows exactly Apple's 15,777,000-second cap and refuses one second more", () => {
    const input = { key: privateKey, teamId: TEAM_ID, keyId: KEY_ID, servicesId: SERVICES_ID, issuedAt: NOW_SECONDS };
    expect(MAX_LIFETIME_SECONDS).toBe(15_777_000);
    const { jwt } = buildAppleClientSecret({ ...input, lifetimeSeconds: MAX_LIFETIME_SECONDS });
    const { claims } = decode(jwt);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(15_777_000);
    expect(() => buildAppleClientSecret({ ...input, lifetimeSeconds: MAX_LIFETIME_SECONDS + 1 })).toThrow(SecretError);
    expect(() => buildAppleClientSecret({ ...input, lifetimeSeconds: 0 })).toThrow(SecretError);
    expect(() => buildAppleClientSecret({ ...input, lifetimeSeconds: 1.5 })).toThrow(SecretError);
  });
});

describe("loadSigningKey", () => {
  it("refuses keys that aren't EC P-256, naming only the path", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey.export({ type: "pkcs8", format: "pem" });
    for (const pem of [rsa.toString(), p384.toString()]) {
      expect(() => loadSigningKey(pem, KEY_PATH)).toThrow(`${KEY_PATH} isn't an EC P-256 key`);
    }
  });

  it("refuses something that isn't a key without echoing it", () => {
    const junk = "-----BEGIN PRIVATE KEY-----\nnot-a-key-SECRET-LOOKING-TEXT\n-----END PRIVATE KEY-----\n";
    let message = "";
    try {
      loadSigningKey(junk, KEY_PATH);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(`${KEY_PATH} isn't a readable private key`);
    expect(message).not.toContain("SECRET-LOOKING");
  });
});

describe("parseArgs", () => {
  it("reads every flag, in either form, with the 180-day default", () => {
    expect(parseArgs(ARGS)).toEqual({
      ok: true,
      options: { keyPath: KEY_PATH, teamId: TEAM_ID, keyId: KEY_ID, servicesId: SERVICES_ID, days: DEFAULT_DAYS },
    });
    expect(DEFAULT_DAYS).toBe(180);
    const eq = parseArgs([`--key=${KEY_PATH}`, `--team-id=${TEAM_ID}`, `--key-id=${KEY_ID}`, `--services-id=${SERVICES_ID}`, "--days=30"]);
    expect(eq.ok && eq.options.days).toBe(30);
  });

  it("caps --days at 182 (Apple's limit) and refuses more", () => {
    expect(MAX_DAYS).toBe(182);
    const ok = parseArgs([...ARGS, "--days", "182"]);
    expect(ok.ok && ok.options.days).toBe(182);
    const over = parseArgs([...ARGS, "--days", "183"]);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.reason).toContain("over Apple's limit");
    for (const bad of ["0", "-1", "1.5", "six"]) expect(parseArgs([...ARGS, "--days", bad]).ok).toBe(false);
  });

  it("refuses missing, unknown, repeated and malformed arguments", () => {
    expect(parseArgs([])).toMatchObject({ ok: false, reason: "Missing --key, --team-id, --key-id, --services-id." });
    expect(parseArgs([...ARGS, "--audience", "x"])).toMatchObject({ ok: false });
    expect(parseArgs([...ARGS, "--team-id", TEAM_ID])).toMatchObject({ ok: false, reason: "--team-id was given twice." });
    expect(parseArgs(["--key", "--team-id", TEAM_ID])).toMatchObject({ ok: false, reason: "--key needs a value." });
    const swap = (flag: string, value: string) => {
      const argv = [...ARGS];
      argv[argv.indexOf(flag) + 1] = value;
      return parseArgs(argv);
    };
    expect(swap("--team-id", "team123456").ok).toBe(false);
    expect(swap("--key-id", "SHORT").ok).toBe(false);
    expect(swap("--services-id", "nodots").ok).toBe(false);
    expect(swap("--services-id", "https://au.com.sheltuh.web").ok).toBe(false);
  });
});

describe("main", () => {
  it("prints only the JWT on stdout and its expiry on stderr, never the key", () => {
    const result = run(ARGS);
    expect(result.code).toBe(0);
    expect(result.reads).toEqual([KEY_PATH]);
    expect(result.out).toHaveLength(1);
    const jwt = result.out[0];
    expect(verifies(jwt)).toBe(true);
    const { claims } = decode(jwt);
    expect(claims.iat).toBe(NOW_SECONDS);
    expect(Number(claims.exp) - NOW_SECONDS).toBe(180 * 86_400);
    expect(result.err.join("\n")).toContain("Expires 2027-04-22T00:00:00.000Z (180 days)");
    expect(result.all).not.toContain("PRIVATE KEY");
    expect(result.all).not.toContain(PEM_BODY);
  });

  it("refuses a lifetime over the cap before reading the key", () => {
    const result = run([...ARGS, "--days", "200"]);
    expect(result.code).toBe(1);
    expect(result.reads).toEqual([]);
    expect(result.out).toEqual([]);
    expect(result.err[0]).toContain("over Apple's limit");
  });

  it("reports an unreadable or unusable key file by path only", () => {
    const missing = run(ARGS, {
      readFile: () => {
        throw new Error(`ENOENT: no such file, open '${KEY_PATH}'`);
      },
    });
    expect(missing).toMatchObject({ code: 1, out: [], err: [`Couldn't read ${KEY_PATH}.`] });

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const wrong = run(ARGS, { readFile: () => rsa });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toEqual([]);
    expect(wrong.all).toContain("isn't an EC P-256 key");
    expect(wrong.all).not.toContain(rsa.split("\n")[1]);
  });

  it("prints usage for --help (exit 0) and bad arguments (exit 1)", () => {
    const help = run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toEqual([]);
    expect(help.err.join("\n")).toContain("npm run apple-client-secret --");
    const bad = run(["--team-id", TEAM_ID]);
    expect(bad.code).toBe(1);
    expect(bad.err.join("\n")).toContain("Missing --key, --key-id, --services-id.");
  });
});
