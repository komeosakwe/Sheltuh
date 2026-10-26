import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketQrPayload } from "@/lib/ticket-code";
import { googleWalletConfigFromEnv, loadWalletConfig, normalisePem, type GoogleWalletConfig } from "@/lib/server/wallet/config";
import {
  buildGoogleSaveJwt,
  googleClassId,
  googleIdPart,
  googleObjectId,
  googleSaveUrl,
  GOOGLE_SAVE_URL_BASE,
} from "@/lib/server/wallet/google";
import { localIsoWithOffset, passTimeZone, walletQrPayload, walletSerial } from "@/lib/server/wallet/pass-content";
import { decodeJwt, googleWalletEnv, rsaKeyPair, sampleTicket, TEST_EVENT_ID as EVENT_ID, TEST_ISSUER_ID, TEST_SERVICE_ACCOUNT } from "./helpers/wallet";

// "Add to Google Wallet" (lib/server/wallet/google.ts, config.ts): the
// configuration's rules, and the signed "Save to Google Wallet" JWT, checked
// with a key pair made here. The routes are wallet-passes.test.ts.

function config(): { config: GoogleWalletConfig; publicKey: ReturnType<typeof rsaKeyPair>["publicKey"] } {
  const { env, keys } = googleWalletEnv();
  const result = googleWalletConfigFromEnv(env);
  if (!("config" in result)) throw new Error(`unexpected: ${result.problems.join("; ")}`);
  return { config: result.config, publicKey: keys.publicKey };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google Wallet configuration", () => {
  it("is off, quietly, when none of its variables is set", () => {
    expect(googleWalletConfigFromEnv({})).toEqual({ problems: [] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadWalletConfig("Google Wallet", () => googleWalletConfigFromEnv({}))).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it("is on with all three, the key as Vercel stores it (literal \\n, or pasted with its quotes)", () => {
    const { env, keys } = googleWalletEnv();
    expect(googleWalletConfigFromEnv(env)).toHaveProperty("config.issuerId", TEST_ISSUER_ID);
    const quoted = { ...env, GOOGLE_WALLET_PRIVATE_KEY: `"${env.GOOGLE_WALLET_PRIVATE_KEY}"` };
    expect(googleWalletConfigFromEnv(quoted)).toHaveProperty("config.serviceAccountEmail", TEST_SERVICE_ACCOUNT);
    const multiline = { ...env, GOOGLE_WALLET_PRIVATE_KEY: keys.privatePem };
    expect(googleWalletConfigFromEnv(multiline)).toHaveProperty("config");
    expect(normalisePem("\"-----BEGIN X-----\\nAB\\r\\nCD\\n-----END X-----\\n\"")).toBe("-----BEGIN X-----\nAB\nCD\n-----END X-----");
  });

  it("is off when one is missing or invalid, naming the variable and never its value", () => {
    const { env } = googleWalletEnv();
    const cases: [Record<string, string | undefined>, string][] = [
      [{ ...env, GOOGLE_WALLET_ISSUER_ID: undefined }, "GOOGLE_WALLET_ISSUER_ID isn't set"],
      [{ ...env, GOOGLE_WALLET_ISSUER_ID: "issuer-abc" }, "GOOGLE_WALLET_ISSUER_ID isn't an issuer ID"],
      [{ ...env, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: "" }, "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL isn't set"],
      [{ ...env, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: "kome@gmail.com" }, "isn't a service account address"],
      [{ ...env, GOOGLE_WALLET_PRIVATE_KEY: undefined }, "GOOGLE_WALLET_PRIVATE_KEY isn't set"],
      [{ ...env, GOOGLE_WALLET_PRIVATE_KEY: "not a key" }, "GOOGLE_WALLET_PRIVATE_KEY isn't an RSA private key"],
      // A truncated paste.
      [{ ...env, GOOGLE_WALLET_PRIVATE_KEY: env.GOOGLE_WALLET_PRIVATE_KEY!.slice(0, 400) }, "GOOGLE_WALLET_PRIVATE_KEY isn't an RSA private key"],
    ];
    for (const [values, problem] of cases) {
      const result = googleWalletConfigFromEnv(values);
      expect(result).not.toHaveProperty("config");
      const problems = (result as { problems: string[] }).problems.join("; ");
      expect(problems).toContain(problem);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(loadWalletConfig("Google Wallet", () => result)).toBeUndefined();
      const logged = error.mock.calls.flat().join(" ");
      expect(logged).toContain("Google Wallet passes are off");
      for (const secret of [env.GOOGLE_WALLET_PRIVATE_KEY!.slice(40, 80), "kome@gmail.com", "issuer-abc", "not a key"]) {
        expect(logged).not.toContain(secret);
      }
      error.mockRestore();
    }
  });

  it("reading the configuration never throws: anything unexpected just turns the wallet off, logged without detail", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = loadWalletConfig("Google Wallet", () => {
      throw new Error("-----BEGIN PRIVATE KEY----- secret detail");
    });
    expect(result).toBeUndefined();
    expect(error).toHaveBeenCalledWith("Google Wallet passes are off: its configuration couldn't be read.");
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret detail");
  });

  it("refuses a key that isn't RSA, or is under 2048 bits", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { env } = googleWalletEnv();
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    for (const key of [ec, small]) {
      expect(googleWalletConfigFromEnv({ ...env, GOOGLE_WALLET_PRIVATE_KEY: key })).not.toHaveProperty("config");
    }
  });
});

describe("the Save to Google Wallet JWT", () => {
  it("is RS256, signed by the service account's key, with Google's claims", () => {
    const { config: google, publicKey } = config();
    const jwt = buildGoogleSaveJwt(google, sampleTicket(), "https://sheltuh.com.au/", 1_800_000_000);
    const { header, claims, verified } = decodeJwt(jwt, publicKey);
    expect(verified).toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: TEST_SERVICE_ACCOUNT,
      aud: "google",
      typ: "savetowallet",
      iat: 1_800_000_000,
      origins: ["https://sheltuh.com.au"],
    });
    expect(Object.keys(claims.payload)).toEqual(["eventTicketClasses", "eventTicketObjects"]);
    // Any other key doesn't verify it.
    expect(decodeJwt(jwt, rsaKeyPair().publicKey).verified).toBe(false);
    // Tampering breaks it.
    const [h, c, s] = jwt.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, iss: "attacker@evil.iam.gserviceaccount.com" })).toString("base64url");
    expect(decodeJwt(`${h}.${forged}.${s}`, publicKey).verified).toBe(false);
    expect(c).not.toBe(forged);
    expect(googleSaveUrl(jwt)).toBe(`${GOOGLE_SAVE_URL_BASE}${jwt}`);
    expect(GOOGLE_SAVE_URL_BASE).toBe("https://pay.google.com/gp/v/save/");
  });

  it("carries one class (the event) and one object (the ticket), the barcode exactly the ticket's existing QR payload", () => {
    const { config: google, publicKey } = config();
    const ticket = sampleTicket();
    const { claims } = decodeJwt(buildGoogleSaveJwt(google, ticket, "https://sheltuh.com.au"), publicKey);
    const [cls] = claims.payload.eventTicketClasses;
    const [object] = claims.payload.eventTicketObjects;
    expect(claims.payload.eventTicketClasses).toHaveLength(1);
    expect(claims.payload.eventTicketObjects).toHaveLength(1);

    expect(cls.id).toBe(`${TEST_ISSUER_ID}.sheltuh-event-${EVENT_ID}`);
    expect(object.id).toBe(`${TEST_ISSUER_ID}.sheltuh-ticket-${walletSerial("7KQM-2HXD")}`);
    expect(object.classId).toBe(cls.id);
    for (const id of [cls.id, object.id]) expect(id).toMatch(/^\d+\.[A-Za-z0-9._-]+$/);

    expect(object.barcode).toEqual({ type: "QR_CODE", value: "SH1:7KQM-2HXD", alternateText: "7KQM-2HXD" });
    expect(object.barcode.value).toBe(ticketQrPayload(ticket.code));

    expect(cls).toMatchObject({
      issuerName: "Sheltüh",
      reviewStatus: "UNDER_REVIEW",
      eventName: { defaultValue: { language: "en-AU", value: "Neon Static" } },
      venue: {
        name: { defaultValue: { language: "en-AU", value: "The Tote" } },
        address: { defaultValue: { language: "en-AU", value: "71 Johnston St, Collingwood" } },
      },
      // The venue's local time with its offset (AEDT in March).
      dateTime: { start: "2027-03-06T20:00:00+11:00", end: "2027-03-06T23:30:00+11:00" },
      logo: { sourceUri: { uri: "https://sheltuh.com.au/wallet/google-logo.png" } },
      heroImage: { sourceUri: { uri: "https://sheltuh.com.au/wallet/google-hero.png" } },
      hexBackgroundColor: "#fdf9e6",
    });
    expect(object).toMatchObject({
      state: "ACTIVE",
      ticketType: { defaultValue: { language: "en-AU", value: "General admission" } },
      ticketNumber: "2 of 3",
    });
    expect(object).not.toHaveProperty("seatInfo");
    expect(object.textModulesData).toEqual([
      { id: "when", header: "When", body: "Sat 6 Mar, 8:00 pm – 11:30 pm AEDT" },
      { id: "order", header: "Order reference", body: "#7C1F2E0A" },
    ]);
  });

  it("names a seat, and a code that isn't a canonical one gets no barcode, only its entry code", () => {
    const { config: google, publicKey } = config();
    const seated = sampleTicket({ seat: { section: "Stalls", row: "F", seat: "12", kind: "standard" } });
    const [object] = decodeJwt(buildGoogleSaveJwt(google, seated, "https://sheltuh.com.au"), publicKey).claims.payload.eventTicketObjects;
    expect(object.seatInfo).toEqual({
      seat: { defaultValue: { language: "en-AU", value: "12" } },
      row: { defaultValue: { language: "en-AU", value: "F" } },
      section: { defaultValue: { language: "en-AU", value: "Stalls" } },
    });

    const legacy = sampleTicket({ code: "legacy-code", qrPayload: walletQrPayload("legacy-code") });
    const [old] = decodeJwt(buildGoogleSaveJwt(google, legacy, "https://sheltuh.com.au"), publicKey).claims.payload.eventTicketObjects;
    expect(old).not.toHaveProperty("barcode");
    expect(old.textModulesData).toContainEqual({ id: "code", header: "Entry code", body: "legacy-code" });
  });

  it("one ticket's save URL stays under 5 KB, even at the longest field lengths the API accepts", () => {
    const { config: google } = config();
    // The database's and the API's limits: title 150, venue name 150, address 250, suburb 100, ticket type
    // name 150, seat labels 40 / 10 / 10 (lib/server/event-input.ts, lib/seating/template.ts).
    const longest = sampleTicket({
      eventTitle: "T".repeat(150),
      venueName: "V".repeat(150),
      venueAddress: "A".repeat(250),
      suburb: "S".repeat(100),
      ticketTypeName: "N".repeat(150),
      seat: { section: "X".repeat(40), row: "R".repeat(10), seat: "9".repeat(10), kind: "standard" },
    });
    const length = googleSaveUrl(buildGoogleSaveJwt(google, longest, "https://sheltuh.com.au")).length;
    expect(length).toBeLessThan(5120);
  });

  it("holds nothing about the buyer or the order beyond its short reference", () => {
    const { config: google, publicKey } = config();
    const raw = JSON.stringify(decodeJwt(buildGoogleSaveJwt(google, sampleTicket(), "https://sheltuh.com.au"), publicKey).claims);
    expect(raw).not.toMatch(/@example\.com|ord_|buyer|email/i);
  });

  it("ids keep to Google's characters; times carry the zone's offset either side of daylight saving", () => {
    expect(googleIdPart("sheltuh-event-a b/c_d.e~f")).toBe("sheltuh-event-abc_d.ef");
    expect(googleClassId("123", "a!b")).toBe("123.sheltuh-event-ab");
    expect(googleObjectId("123", "7KQM-2HXD")).toMatch(/^123\.sheltuh-ticket-[0-9a-f]{32}$/);
    expect(walletSerial("7KQM-2HXD")).toBe(walletSerial("7KQM-2HXD"));
    expect(walletSerial("7KQM-2HXD")).not.toBe(walletSerial("7KQM-2HXE"));
    expect(localIsoWithOffset("2027-07-10T10:00:00.000Z", "Australia/Melbourne")).toBe("2027-07-10T20:00:00+10:00");
    expect(localIsoWithOffset("2027-01-10T09:00:00.000Z", "Australia/Melbourne")).toBe("2027-01-10T20:00:00+11:00");
    expect(localIsoWithOffset("2027-01-10T09:00:00.000Z", "Australia/Perth")).toBe("2027-01-10T17:00:00+08:00");
    expect(localIsoWithOffset("2027-01-10T09:00:00.000Z", "Australia/Lord_Howe")).toBe("2027-01-10T20:00:00+11:00");
    expect(localIsoWithOffset("2027-07-10T09:00:00.000Z", "Australia/Lord_Howe")).toBe("2027-07-10T19:30:00+10:30");
    expect(passTimeZone()).toBe("Australia/Melbourne");
  });
});
