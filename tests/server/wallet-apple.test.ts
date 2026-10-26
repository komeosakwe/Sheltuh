import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketQrPayload } from "@/lib/ticket-code";
import { applePassJson, buildApplePass, zipStore } from "@/lib/server/wallet/apple";
import { appleWalletConfigFromEnv, decodePemVariable, loadWalletConfig, type AppleWalletConfig } from "@/lib/server/wallet/config";
import { APPLE_PASS_IMAGES } from "@/lib/server/wallet/images";
import { walletQrPayload, walletSerial } from "@/lib/server/wallet/pass-content";
import {
  appleWalletEnv,
  readZip,
  sampleTicket,
  TEST_EVENT_ID,
  TEST_PASS_TYPE_ID,
  TEST_TEAM_ID,
  verifyDetachedSignature,
} from "./helpers/wallet";

// "Add to Apple Wallet" (lib/server/wallet/apple.ts, config.ts): the
// configuration's rules, and the .pkpass, signed with a test certificate
// chain made here (a stand-in WWDR intermediate and a Pass Type ID
// certificate with Apple's subject layout) and checked independently. The
// routes are wallet-passes.test.ts.

function apple(options: Parameters<typeof appleWalletEnv>[0] = {}) {
  const chain = appleWalletEnv(options);
  const result = appleWalletConfigFromEnv(chain.env);
  if (!("config" in result)) throw new Error(`unexpected: ${result.problems.join("; ")}`);
  return { ...chain, config: result.config as AppleWalletConfig };
}

const problemsOf = (env: Record<string, string | undefined>, now?: number) => {
  const result = appleWalletConfigFromEnv(env, now);
  expect(result).not.toHaveProperty("config");
  return (result as { problems: string[] }).problems.join("; ");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Apple Wallet configuration", () => {
  it("is off, quietly, when none of its variables is set", () => {
    expect(appleWalletConfigFromEnv({})).toEqual({ problems: [] });
  });

  it("is on with a valid chain: base64 PEMs, an encrypted key with its passphrase, or raw PEMs", () => {
    const { config } = apple();
    expect(config).toMatchObject({ passTypeId: TEST_PASS_TYPE_ID, teamId: TEST_TEAM_ID });
    expect(config.certExpiresAt).toBeGreaterThan(Date.now());
    apple({ passphrase: "correct horse battery staple" });
    const raw = appleWalletEnv();
    const pasted = {
      ...raw.env,
      APPLE_WALLET_CERT_PEM: raw.signerPem.replace(/\n/g, "\\n"),
      APPLE_WALLET_WWDR_PEM: raw.wwdrPem,
    };
    expect(appleWalletConfigFromEnv(pasted)).toHaveProperty("config");
    expect(decodePemVariable("not base64 !!")).toBeUndefined();
    expect(decodePemVariable(Buffer.from("hello").toString("base64"))).toBeUndefined();
  });

  it("is off when any required variable is missing, naming it", () => {
    const { env } = appleWalletEnv();
    for (const name of ["APPLE_WALLET_PASS_TYPE_ID", "APPLE_WALLET_TEAM_ID", "APPLE_WALLET_CERT_PEM", "APPLE_WALLET_KEY_PEM", "APPLE_WALLET_WWDR_PEM"]) {
      expect(problemsOf({ ...env, [name]: undefined })).toContain(`${name} isn't set`);
    }
  });

  it("is off for a wrong passphrase, an expired certificate, another key, another issuer, or another pass type or team", () => {
    const encrypted = appleWalletEnv({ passphrase: "right" });
    expect(problemsOf({ ...encrypted.env, APPLE_WALLET_KEY_PASSPHRASE: "wrong" })).toContain("APPLE_WALLET_KEY_PEM isn't");
    expect(problemsOf({ ...encrypted.env, APPLE_WALLET_KEY_PASSPHRASE: undefined })).toContain("APPLE_WALLET_KEY_PEM isn't");
    expect(problemsOf(appleWalletEnv({ expired: true }).env)).toContain("APPLE_WALLET_CERT_PEM isn't valid now");
    // Valid today, but not once it has expired.
    expect(problemsOf(appleWalletEnv().env, Date.now() + 400 * 24 * 60 * 60 * 1000)).toContain("isn't valid now");
    const one = appleWalletEnv();
    const other = appleWalletEnv();
    expect(problemsOf({ ...one.env, APPLE_WALLET_KEY_PEM: other.env.APPLE_WALLET_KEY_PEM })).toContain(
      "APPLE_WALLET_KEY_PEM isn't the private key of APPLE_WALLET_CERT_PEM",
    );
    expect(problemsOf({ ...one.env, APPLE_WALLET_WWDR_PEM: other.env.APPLE_WALLET_WWDR_PEM })).toContain("APPLE_WALLET_WWDR_PEM didn't issue");
    expect(problemsOf(appleWalletEnv({ otherWwdr: true }).env)).toContain("APPLE_WALLET_WWDR_PEM didn't issue");
    expect(problemsOf(appleWalletEnv({ passTypeId: "pass.au.com.someone.else" }).env)).toContain("another Pass Type ID");
    expect(problemsOf(appleWalletEnv({ teamId: "ZZZZZ99999" }).env)).toContain("another team");
    expect(problemsOf({ ...one.env, APPLE_WALLET_PASS_TYPE_ID: "com.sheltuh" })).toContain("isn't a Pass Type ID");
    expect(problemsOf({ ...one.env, APPLE_WALLET_TEAM_ID: "abc" })).toContain("isn't a Team ID");
    expect(problemsOf({ ...one.env, APPLE_WALLET_CERT_PEM: "bm90IGEgY2VydA==" })).toContain("APPLE_WALLET_CERT_PEM isn't a base64-encoded PEM");
  });

  it("logs which variable is wrong, never a value", () => {
    const { env } = appleWalletEnv({ passphrase: "s3cret-passphrase" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      loadWalletConfig("Apple Wallet", () => appleWalletConfigFromEnv({ ...env, APPLE_WALLET_KEY_PASSPHRASE: "wrong-passphrase" })),
    ).toBeUndefined();
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("Apple Wallet passes are off: APPLE_WALLET_KEY_PEM");
    for (const value of Object.values(env)) expect(logged).not.toContain(value!.slice(0, 24));
    expect(logged).not.toContain("wrong-passphrase");
    expect(logged).not.toContain("BEGIN");
  });
});

describe("the .pkpass", () => {
  it("is a zip whose manifest hashes every other file, signed (detached PKCS #7) by the pass certificate with the WWDR intermediate", () => {
    const { config, signerPem, wwdrPem } = apple();
    const files = readZip(buildApplePass(config, sampleTicket()));
    expect([...files.keys()].sort()).toEqual(
      [
        "pass.json",
        "manifest.json",
        "signature",
        "icon.png",
        "icon@2x.png",
        "icon@3x.png",
        "logo.png",
        "logo@2x.png",
        "logo@3x.png",
        "strip.png",
        "strip@2x.png",
        "strip@3x.png",
      ].sort(),
    );
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    expect(Object.keys(manifest).sort()).toEqual([...files.keys()].filter((n) => n !== "manifest.json" && n !== "signature").sort());
    for (const [name, sha1] of Object.entries(manifest)) {
      expect(createHash("sha1").update(files.get(name)!).digest("hex"), name).toBe(sha1);
    }
    verifyDetachedSignature(files.get("signature")!, files.get("manifest.json")!, signerPem, wwdrPem);
  });

  it("a signature made with another chain doesn't verify against this one", () => {
    const { config } = apple();
    const other = apple();
    const files = readZip(buildApplePass(config, sampleTicket()));
    expect(() => verifyDetachedSignature(files.get("signature")!, files.get("manifest.json")!, other.signerPem, other.wwdrPem)).toThrow();
    // Nor does the signature fit another manifest.
    expect(() => verifyDetachedSignature(files.get("signature")!, Buffer.from("{}"), apple().signerPem, apple().wwdrPem)).toThrow();
  });

  it("pass.json: the identifiers, a stable serial, the brand colours, the event ticket layout and the QR with exactly the existing payload", () => {
    const { config } = apple();
    const ticket = sampleTicket({ seat: { section: "Stalls", row: "F", seat: "12", kind: "standard" } });
    const pass = JSON.parse(readZip(buildApplePass(config, ticket)).get("pass.json")!.toString("utf8"));
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: TEST_PASS_TYPE_ID,
      teamIdentifier: TEST_TEAM_ID,
      serialNumber: walletSerial("7KQM-2HXD"),
      organizationName: "Sheltüh",
      description: "Ticket for Neon Static",
      groupingIdentifier: `sheltuh-event-${TEST_EVENT_ID}`,
      sharingProhibited: true,
      backgroundColor: "rgb(253, 249, 230)",
      foregroundColor: "rgb(0, 0, 0)",
      relevantDate: "2027-03-06T20:00:00+11:00",
      barcodes: [{ format: "PKBarcodeFormatQR", message: "SH1:7KQM-2HXD", messageEncoding: "iso-8859-1", altText: "7KQM-2HXD" }],
    });
    expect(pass.barcodes[0].message).toBe(ticketQrPayload(ticket.code));
    // No web service in v1.
    for (const key of ["webServiceURL", "authenticationToken", "barcode"]) expect(pass).not.toHaveProperty(key);
    expect(pass.eventTicket.headerFields).toEqual([{ key: "date", label: "DATE", value: "Sat 6 Mar 2027" }]);
    expect(pass.eventTicket.primaryFields).toEqual([{ key: "event", label: "EVENT", value: "Neon Static" }]);
    expect(pass.eventTicket.secondaryFields).toEqual([
      { key: "time", label: "TIME", value: "8:00 pm AEDT" },
      { key: "venue", label: "VENUE", value: "The Tote" },
    ]);
    expect(pass.eventTicket.auxiliaryFields).toEqual([
      { key: "ticket", label: "TICKET", value: "General admission · Ticket 2 of 3" },
      { key: "seat", label: "SEAT", value: "Stalls · Row F · Seat 12" },
    ]);
    const back = Object.fromEntries((pass.eventTicket.backFields as { key: string; value: string }[]).map((f) => [f.key, f.value]));
    expect(back).toMatchObject({
      when: "Sat 6 Mar, 8:00 pm – 11:30 pm AEDT",
      where: "The Tote, 71 Johnston St, Collingwood",
      "backup-code": "7KQM-2HXD",
      order: "#7C1F2E0A",
    });
    // Nothing about the buyer.
    expect(JSON.stringify(pass)).not.toMatch(/@example\.com|ord_/);
    // The same ticket always gets the same serial: adding it again replaces the pass.
    expect(applePassJson(config, ticket).serialNumber).toBe(pass.serialNumber);
  });

  it("a code that isn't a canonical one gets no barcode, its entry code on the front instead", () => {
    const { config } = apple();
    const pass = applePassJson(config, sampleTicket({ code: "legacy", qrPayload: walletQrPayload("legacy") }));
    expect(pass).not.toHaveProperty("barcodes");
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({ key: "code", label: "ENTRY CODE", value: "legacy" });
  });

  it("carries the images rendered into public/wallet/ byte for byte", () => {
    for (const [name, base64] of Object.entries(APPLE_PASS_IMAGES)) {
      const file = readFileSync(path.join(process.cwd(), "public/wallet", `apple-${name}`));
      expect(Buffer.from(base64, "base64").equals(file), name).toBe(true);
      // A PNG.
      expect(file.subarray(1, 4).toString("latin1")).toBe("PNG");
    }
  });

  it("zipStore writes a standard stored zip", () => {
    const zip = zipStore([
      ["a.txt", Buffer.from("hello")],
      ["ü/b.bin", Buffer.from([0, 1, 2, 255])],
    ]);
    const files = readZip(zip);
    expect(files.get("a.txt")!.toString()).toBe("hello");
    expect([...files.get("ü/b.bin")!]).toEqual([0, 1, 2, 255]);
  });
});
