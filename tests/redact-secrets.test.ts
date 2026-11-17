import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  echoable,
  looksSecret,
  MAX_ECHO_LENGTH,
  REDACTED,
  redactSecrets,
  redacting,
  showArg,
} from "@/scripts/redact-secrets";

// Shaped like real secrets, never real ones.
const STRIPE_KEYS = [
  "sk_live_" + "51FakeSecretKeyValue0000000000000000",
  "sk_test_" + "51FakeSecretKeyValue1111111111111111",
  "rk_live_" + "51FakeRestrictedKeyValue22222222222",
  "rk_test_" + "51FakeRestrictedKeyValue33333333333",
  "pk_live_" + "51FakePublishableKeyValue4444444444",
  "pk_test_" + "51FakePublishableKeyValue5555555555",
];
const MASKED = ["sk_live_****************0000", "rk_test_•••••1234", "sk_live_…abcd"];
const WEBHOOK_SECRET = "whsec_" + "FakeWebhookSigningSecret0123456789abcdef";

function pemKey() {
  const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const body = pem.trim().split("\n").slice(1, -1);
  return { pem, body };
}

describe("redactSecrets", () => {
  it("removes Stripe keys (masked ones too) and webhook secrets, keeping the text around them", () => {
    for (const key of [...STRIPE_KEYS, ...MASKED, WEBHOOK_SECRET]) {
      expect(redactSecrets(`Invalid API Key provided: ${key}.`), key).toBe(`Invalid API Key provided: ${REDACTED}.`);
    }
  });

  it("removes a whole PEM private key, and a truncated one to the end of the text", () => {
    const { pem, body } = pemKey();
    const out = redactSecrets(`before\n${pem}after`);
    expect(out).toBe(`before\n${REDACTED}\nafter`);
    const truncated = redactSecrets(`got: ${pem.slice(0, 80)}`);
    expect(truncated).toBe(`got: ${REDACTED}`);
    for (const line of body) expect(out).not.toContain(line);
  });

  it("removes long base64 runs: every line of generated .p8 bodies, and random base64", () => {
    for (let i = 0; i < 25; i += 1) {
      const { body } = pemKey();
      const out = redactSecrets(`Couldn't read ${body.join("\n")}.`);
      for (const line of body) expect(out).not.toContain(line);
      expect(redactSecrets(randomBytes(48).toString("base64"))).toBe(REDACTED);
    }
  });

  // Random .p8 lines that slipped through about 1 in 2,000 times (PR 54's CI): pinned so it isn't luck.
  it("removes base64 lines whose stretches between slashes are digit-free or short", () => {
    for (const line of [
      // The 41-character stretch has no digit (the line from the CI failure).
      "oqEs1JX/w0/fyn87kallcx/tSCWhRANCAARUQJPtGlelcFQtzwGCGabyxIxifhws",
      // Five slashes, no stretch of 16 or more.
      "Ab3dEfGh9jKl/Mn0pQrStUv2/Wx4zAbCdEf6/GhIjKl8MnOp/QrSt1UvWxYz/AbCd",
      // A 56-character last line, seven slashes, as dense as a path: its stretches aren't words.
      "21P3YQIwci/8cp8ozDXdA/N0/LR2noP/UHFExb9At65/8LRAOQ3cizr8",
      // No digit anywhere in 64 characters.
      "ZtIDXTVMWhBCMrEgfeucWbcSoFMUwdROsCkuY/KSRDzeoSpndNtWbfWCPcjoDsf/",
    ]) {
      expect(redactSecrets(`Couldn't read ${line}.`), line).toBe(`Couldn't read ${REDACTED}.`);
    }
  });

  it("leaves ordinary output alone: hostnames, Stripe IDs, file paths, usage and messages", () => {
    for (const text of [
      "app.sheltuh.com.au (pmd_1PgGq2Lkd8xyzAbCdEfGhIjK, test mode)",
      "my-branch-sheltuh-git-feature-checkout-abc123.vercel.app",
      `${"a".repeat(64)}.com.au`,
      "Couldn't read /Users/kome/Library/Mobile Documents/com~apple~CloudDocs/secure/AuthKey_ABCDE12345.p8.",
      "/home/kome/Secure/Keys2026/AppleSignIn/Production/AuthKey_ABCDE12345.p8",
      "C:/Users/Kome/OneDrive/Documents/Sheltuh/Secrets2026/AuthKey_ABCDE12345.p8",
      // Long letters-only and digit-ending paths stay readable under the extra base64 rules.
      "/home/kome/Secure/AppleSignIn/Production/AuthKey.p8",
      "/Users/kome/Projects/Sheltuh/Keys/Apple/Production2026/AuthKey.p8",
      "/var/lib/sheltuh/releases/Build2026/Assets/Fonts/Bootzy/Regular.woff2",
      "The key isn't a Stripe secret (sk_…) or restricted (rk_…) key.",
      "Expires 2027-04-22T00:00:00.000Z (180 days).",
      "Stripe refused the request: No such payment_method_domain: 'pmd_1PgGq2Lkd8xyz' (req_AbC123dEf456)",
    ]) {
      expect(redactSecrets(text), text).toBe(text);
    }
  });

  it("redacting() wraps a print function", () => {
    const lines: string[] = [];
    redacting((line) => lines.push(line))(`key ${STRIPE_KEYS[0]}`);
    expect(lines).toEqual([`key ${REDACTED}`]);
  });
});

describe("looksSecret, echoable and showArg (arguments)", () => {
  it("spots keys, PEM blocks and their pieces, and base64 bodies, including --flag=value", () => {
    const { pem, body } = pemKey();
    const secrets = [
      ...STRIPE_KEYS,
      ...MASKED,
      WEBHOOK_SECRET,
      `--key=${STRIPE_KEYS[0]}`,
      pem,
      body.join("\n"),
      body.join(""),
      ...body, // an unquoted $(cat AuthKey.p8) splits it into words, one per line
      "-----BEGIN",
      "KEY-----",
      `--key=${body.join("")}`,
    ];
    for (const arg of secrets) {
      expect(looksSecret(arg), arg).toBe(true);
      expect(echoable(arg)).toBe(false);
      expect(showArg(arg)).toBe("an argument that looks like a secret key (not shown)");
    }
  });

  it("doesn't flag ordinary arguments, so real paths and IDs still work", () => {
    for (const arg of [
      "app.sheltuh.com.au",
      "--register",
      "--key",
      "/Users/kome/Downloads/SheltuhAppleKeys2026October/AuthKey.p8",
      "/home/kome/Secure/Keys2026/AppleSignIn/Production/AuthKey_ABCDE12345.p8",
      "--key=~/secure/AuthKey_ABCDE12345.p8",
      "ABCDE12345",
      "au.com.sheltuh.web",
      "--days=30",
      "pk_…",
    ]) {
      expect(looksSecret(arg), arg).toBe(false);
    }
  });

  it("never echoes an argument over the length limit, and quotes short ones", () => {
    const long = "x".repeat(MAX_ECHO_LENGTH + 1);
    expect(echoable(long)).toBe(false);
    expect(showArg(long)).toBe(`an argument of ${MAX_ECHO_LENGTH + 1} characters (not shown)`);
    expect(echoable("x".repeat(MAX_ECHO_LENGTH))).toBe(true);
    expect(showArg("--force")).toBe('"--force"');
  });
});
