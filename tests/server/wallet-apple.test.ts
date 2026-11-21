import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketQrPayload } from "@/lib/ticket-code";
import { generateKeyPairSync } from "node:crypto";
import { applePassJson, appleSignerProblem, buildApplePass, loadAppleWallet, zipStore } from "@/lib/server/wallet/apple";
import {
  appleWalletConfigFromEnv,
  appleWalletGetter,
  decodePemVariable,
  hasAppleWalletVariables,
  loadWalletConfig,
  type AppleWalletConfig,
} from "@/lib/server/wallet/config";
import { APPLE_PASS_IMAGES } from "@/lib/server/wallet/images";
import { walletQrPayload } from "@/lib/server/wallet/pass-content";
import {
  appleWalletEnv,
  readZip,
  sampleTicket,
  TEST_EVENT_ID,
  TEST_PASS_TYPE_ID,
  TEST_SERIAL,
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

describe("Apple Wallet: proven before it's offered", () => {
  it("expires with the first of its two certificates", () => {
    const { config } = apple();
    expect(config.expiresFirst).toBe("APPLE_WALLET_CERT_PEM");
    const early = apple({ wwdrDays: 30 }).config;
    expect(early.expiresFirst).toBe("APPLE_WALLET_WWDR_PEM");
    expect(early.certExpiresAt).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);
  });

  it("signs a test manifest once loaded; a value node-forge can't use turns Apple off, naming the variable", () => {
    const { config, env } = apple();
    expect(appleSignerProblem(config)).toBeUndefined();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadAppleWallet(env)).toMatchObject({ passTypeId: TEST_PASS_TYPE_ID });
    expect(error).not.toHaveBeenCalled();

    // An EC key (node:crypto reads it; forge, RSA only, can't) and an unreadable WWDR certificate.
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(appleSignerProblem({ ...config, signerKey: ec })).toBe("APPLE_WALLET_KEY_PEM couldn't be read for signing");
    expect(appleSignerProblem({ ...config, wwdrCertPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" })).toBe(
      "APPLE_WALLET_WWDR_PEM couldn't be read for signing",
    );
    expect(appleSignerProblem({ ...config, signerCertPem: "nope" })).toBe("APPLE_WALLET_CERT_PEM couldn't be read for signing");

    // Unset: quietly off.
    expect(loadAppleWallet({})).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    // Invalid: off, logged by name only.
    expect(loadAppleWallet({ ...env, APPLE_WALLET_TEAM_ID: "x" })).toBeUndefined();
    expect(error.mock.calls.flat().join(" ")).toContain("Apple Wallet passes are off: APPLE_WALLET_TEAM_ID");
    expect(error.mock.calls.flat().join(" ")).not.toContain("BEGIN");
  });

  it("Deps' getter: loads once, then off from the first expiry, logged once naming the variable; a failed load is off", async () => {
    const { config } = apple({ wwdrDays: 30 });
    let now = Date.now();
    const load = vi.fn(async () => config);
    const get = appleWalletGetter(load, () => now);
    expect(await get()).toBe(config);
    expect(await get()).toBe(config);
    expect(load).toHaveBeenCalledTimes(1);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    now = config.certExpiresAt;
    expect(await get()).toBeUndefined();
    expect(await get()).toBeUndefined();
    expect(error.mock.calls).toEqual([["Apple Wallet passes are off: APPLE_WALLET_WWDR_PEM has expired."]]);

    const failing = appleWalletGetter(async () => {
      throw new Error("-----BEGIN PRIVATE KEY----- detail");
    });
    expect(await failing()).toBeUndefined();
    expect(error).toHaveBeenLastCalledWith("Apple Wallet passes are off: its configuration couldn't be read.");
  });

  it("loads the pass builder (and node-forge) only when an Apple variable is set", () => {
    expect(hasAppleWalletVariables({})).toBe(false);
    expect(hasAppleWalletVariables({ APPLE_WALLET_TEAM_ID: "  " })).toBe(false);
    expect(hasAppleWalletVariables({ APPLE_WALLET_KEY_PASSPHRASE: "x" })).toBe(false);
    expect(hasAppleWalletVariables({ APPLE_WALLET_CERT_PEM: "x" })).toBe(true);
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

  it("pass.json: the identifiers, a stable serial, the white pass's colours, the frame's event ticket layout and the QR with exactly the existing payload", () => {
    const { config } = apple();
    const ticket = sampleTicket({ seat: { section: "Stalls", row: "F", seat: "12", kind: "standard" } });
    const pass = JSON.parse(readZip(buildApplePass(config, ticket)).get("pass.json")!.toString("utf8"));
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: TEST_PASS_TYPE_ID,
      teamIdentifier: TEST_TEAM_ID,
      serialNumber: TEST_SERIAL,
      organizationName: "Sheltüh",
      description: "Ticket for Neon Static",
      groupingIdentifier: `sheltuh-event-${TEST_EVENT_ID}`,
      sharingProhibited: true,
      // The designer's 20 Nov 2026 frame: a white pass, Black values and Black labels.
      backgroundColor: "rgb(255, 255, 255)",
      foregroundColor: "rgb(0, 0, 0)",
      labelColor: "rgb(0, 0, 0)",
      relevantDate: "2027-03-06T20:00:00+11:00",
      barcodes: [{ format: "PKBarcodeFormatQR", message: "SH1:7KQM-2HXD", messageEncoding: "iso-8859-1", altText: "7KQM-2HXD" }],
    });
    expect(pass.barcodes[0].message).toBe(ticketQrPayload(ticket.code));
    // No web service in v1.
    for (const key of ["webServiceURL", "authenticationToken", "barcode"]) expect(pass).not.toHaveProperty(key);
    // The frame's front, in its order: DATE in the header; nothing over the strip (no primary field); EVENT
    // and TIME; VENUE and TICKET; each row's last field at the right edge. The seat, which the frame
    // doesn't show, on a second auxiliary row.
    expect(Object.keys(pass.eventTicket)).toEqual(["headerFields", "secondaryFields", "auxiliaryFields", "backFields"]);
    expect(pass.eventTicket.headerFields).toEqual([{ key: "date", label: "DATE", value: "Sat 6 Mar", textAlignment: "PKTextAlignmentRight" }]);
    expect(pass.eventTicket.secondaryFields).toEqual([
      { key: "event", label: "EVENT", value: "Neon Static" },
      { key: "time", label: "TIME", value: "8–11:30 pm", textAlignment: "PKTextAlignmentRight" },
    ]);
    expect(pass.eventTicket.auxiliaryFields).toEqual([
      { key: "venue", label: "VENUE", value: "The Tote" },
      { key: "ticket", label: "TICKET", value: "General admission · Ticket 2 of 3", textAlignment: "PKTextAlignmentRight" },
      { key: "seat", label: "SEAT", value: "Stalls · Row F · Seat 12", row: 1 },
    ]);
    // Every key once: Wallet refuses a pass that repeats one.
    const keys = (["headerFields", "secondaryFields", "auxiliaryFields", "backFields"] as const).flatMap((group) =>
      (pass.eventTicket[group] as { key: string }[]).map((f) => f.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
    const back = Object.fromEntries((pass.eventTicket.backFields as { key: string; value: string }[]).map((f) => [f.key, f.value]));
    expect(back).toMatchObject({
      title: "Neon Static",
      // The year is here: the front's date has none.
      when: "Sat 6 Mar 2027, 8:00 pm – 11:30 pm AEDT",
      where: "The Tote, 71 Johnston St, Collingwood",
      "backup-code": "7KQM-2HXD",
      order: "#7C1F2E0A",
    });
    // Nothing about the buyer.
    expect(JSON.stringify(pass)).not.toMatch(/@example\.com|ord_/);
    // The ticket's stored serial, never anything made from its code.
    expect(applePassJson(config, ticket).serialNumber).toBe(pass.serialNumber);
    expect(applePassJson(config, sampleTicket({ code: "ABCD-EFGH" })).serialNumber).toBe(TEST_SERIAL);
    expect(() => applePassJson(config, sampleTicket({ serial: "7KQM-2HXD" }))).toThrow();
  });

  it("the front as the frame writes it: the ticket type alone for an order of one, the time as a short range, the ticket by itself without a venue", () => {
    const { config } = apple();
    // The frame's own ticket: "Sat 14 Nov", "5–9 pm", "Second release".
    const framed = applePassJson(
      config,
      sampleTicket({
        eventTitle: "Here & Now",
        startsAt: "2026-11-14T06:00:00.000Z",
        endsAt: "2026-11-14T10:00:00.000Z",
        venueName: "Interconnect Studio",
        ticketTypeName: "Second release",
        ticketNumber: 1,
        ticketCount: 1,
      }),
    );
    expect(framed.eventTicket.headerFields.map((f) => [f.label, f.value])).toEqual([["DATE", "Sat 14 Nov"]]);
    expect(framed.eventTicket.secondaryFields.map((f) => [f.label, f.value])).toEqual([
      ["EVENT", "Here & Now"],
      ["TIME", "5–9 pm"],
    ]);
    expect(framed.eventTicket.auxiliaryFields.map((f) => [f.label, f.value])).toEqual([
      ["VENUE", "Interconnect Studio"],
      ["TICKET", "Second release"],
    ]);

    // No end: the start alone. Overnight: both meridiems.
    const time = (overrides: Parameters<typeof sampleTicket>[0]) =>
      applePassJson(config, sampleTicket(overrides)).eventTicket.secondaryFields.find((f) => f.key === "time")?.value;
    expect(time({ endsAt: undefined })).toBe("8 pm");
    expect(time({ endsAt: "2027-03-06T15:00:00.000Z" })).toBe("8 pm–2 am");
    // Another zone's own clock (Perth, 8 pm there).
    expect(time({ startsAt: "2027-03-06T12:00:00.000Z", endsAt: "2027-03-06T15:30:00.000Z", timeZone: "Australia/Perth" })).toBe("8–11:30 pm");

    // Without a venue name the ticket stands alone, at the left.
    for (const venueName of [undefined, "  "]) {
      expect(applePassJson(config, sampleTicket({ venueName })).eventTicket.auxiliaryFields).toEqual([
        { key: "ticket", label: "TICKET", value: "General admission · Ticket 2 of 3" },
      ]);
    }
    // A ticket type with no name.
    const ticketValue = (overrides: Parameters<typeof sampleTicket>[0]) =>
      applePassJson(config, sampleTicket(overrides)).eventTicket.auxiliaryFields.find((f) => f.key === "ticket")?.value;
    expect(ticketValue({ ticketTypeName: "" })).toBe("Ticket 2 of 3");
    expect(ticketValue({ ticketTypeName: " ", ticketNumber: 1, ticketCount: 1 })).toBe("Ticket");
  });

  it("a code that isn't a canonical one gets no barcode, its entry code on the front instead", () => {
    const { config } = apple();
    const pass = applePassJson(config, sampleTicket({ code: "legacy", qrPayload: walletQrPayload("legacy") }));
    expect(pass).not.toHaveProperty("barcodes");
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({ key: "code", label: "ENTRY CODE", value: "legacy", row: 1 });
  });

  it("carries the images rendered into public/wallet/ byte for byte", () => {
    for (const [name, base64] of Object.entries(APPLE_PASS_IMAGES)) {
      const file = readFileSync(path.join(process.cwd(), "public/wallet", `apple-${name}`));
      expect(Buffer.from(base64, "base64").equals(file), name).toBe(true);
      // A PNG.
      expect(file.subarray(1, 4).toString("latin1")).toBe("PNG");
    }
  });

  it("the images are the sizes the frame and Apple ask for: the logo 88 pt wide, an event ticket's 375 x 98 pt strip, each at 1x, 2x and 3x", () => {
    const size = (name: string) => {
      const png = Buffer.from(APPLE_PASS_IMAGES[name], "base64");
      // IHDR: width and height, big-endian, after the 8-byte signature and the chunk's length and type.
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    const scaled = (base: string, scale: number) => size(scale === 1 ? `${base}.png` : `${base}@${scale}x.png`);
    for (const scale of [1, 2, 3]) {
      expect(scaled("icon", scale), `icon ${scale}x`).toEqual([29 * scale, 29 * scale]);
      expect(scaled("logo", scale), `logo ${scale}x`).toEqual([88 * scale, 20 * scale]);
      expect(scaled("strip", scale), `strip ${scale}x`).toEqual([375 * scale, 98 * scale]);
    }
    // The logo is the only one with transparency (colour type 6, RGBA): the pass's white shows through it.
    const colourType = (name: string) => Buffer.from(APPLE_PASS_IMAGES[name], "base64")[25];
    expect(colourType("logo.png")).toBe(6);
    expect(colourType("strip.png")).toBe(2);
    expect(colourType("icon.png")).toBe(2);
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
