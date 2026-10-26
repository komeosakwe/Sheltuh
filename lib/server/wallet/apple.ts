import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import forge from "node-forge";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { appleRgb, WALLET_COLOURS, WALLET_ORGANISATION_NAME } from "./brand";
import { appleWalletConfigFromEnv, loadWalletConfig, type AppleWalletConfig } from "./config";
import { APPLE_PASS_IMAGES } from "./images";
import {
  localIsoWithOffset,
  passDate,
  passSeat,
  passStartTime,
  passTicketNumber,
  passVenue,
  passWhen,
  WALLET_SERIAL_PATTERN,
  type WalletTicket,
} from "./pass-content";

/**
 * "Add to Apple Wallet": one ticket's .pkpass, built here (Apple's "Wallet
 * Developer Guide" format): pass.json, the images (lib/server/wallet/images.ts),
 * manifest.json (each file's SHA-1) and `signature`, a detached PKCS #7
 * signature over manifest.json by the Pass Type ID certificate, carrying
 * Apple's WWDR intermediate. node-forge makes the signature (node:crypto
 * can't make PKCS #7); the zip is written here (stored, not compressed: the
 * PNGs already are, and pass.json is small).
 *
 * No web service in v1: no webServiceURL or authenticationToken, so a saved
 * pass never updates (docs/architecture.md, "Wallet passes").
 */

const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;

/** A zip of `files`, in the given order, every entry stored (method 0) with a fixed 1980-01-01 timestamp. */
export function zipStore(files: [name: string, bytes: Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal attributes, external attributes: all 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

type PassField = { key: string; label?: string; value: string };

/** pass.json (exported for tests). */
export function applePassJson(config: Pick<AppleWalletConfig, "passTypeId" | "teamId">, ticket: WalletTicket) {
  if (!WALLET_SERIAL_PATTERN.test(ticket.serial)) throw new Error("A wallet pass serial must be 32 hex characters.");
  const venue = passVenue(ticket);
  const seat = passSeat(ticket);
  const ticketLine = [ticket.ticketTypeName, passTicketNumber(ticket)].filter(Boolean).join(" · ");
  const secondaryFields: PassField[] = [{ key: "time", label: "TIME", value: passStartTime(ticket) }];
  if (ticket.venueName?.trim()) secondaryFields.push({ key: "venue", label: "VENUE", value: ticket.venueName.trim() });
  const auxiliaryFields: PassField[] = [{ key: "ticket", label: "TICKET", value: ticketLine }];
  if (seat) auxiliaryFields.push({ key: "seat", label: "SEAT", value: seat });
  if (!ticket.qrPayload) auxiliaryFields.push({ key: "code", label: "ENTRY CODE", value: ticket.code });
  const backFields: PassField[] = [
    { key: "when", label: "When", value: passWhen(ticket) },
    ...(venue ? [{ key: "where", label: "Where", value: venue }] : []),
    { key: "backup-code", label: ticket.qrPayload ? "Backup code" : "Entry code", value: ticket.code },
    { key: "order", label: "Order reference", value: ticket.orderReference },
    {
      key: "door",
      label: "At the door",
      value: ticket.qrPayload
        ? "Show the QR code. If it won't scan, door staff can type in the backup code. Each code gets in once, so don't share it."
        : "Show the entry code. Each code gets in once, so don't share it.",
    },
    { key: "help", label: "Need a hand?", value: SUPPORT_EMAIL },
  ];
  const start = localIsoWithOffset(ticket.startsAt, ticket.timeZone);
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    serialNumber: ticket.serial,
    organizationName: WALLET_ORGANISATION_NAME,
    description: `Ticket for ${ticket.eventTitle}`,
    groupingIdentifier: `sheltuh-event-${ticket.eventId}`,
    // The door admits each code once; sharing the pass would share the ticket.
    sharingProhibited: true,
    backgroundColor: appleRgb(WALLET_COLOURS.ivory),
    foregroundColor: appleRgb(WALLET_COLOURS.ink),
    labelColor: appleRgb(WALLET_COLOURS.muted),
    relevantDate: start,
    ...(ticket.endsAt ? { relevantDates: [{ startDate: start, endDate: localIsoWithOffset(ticket.endsAt, ticket.timeZone) }] } : {}),
    ...(ticket.qrPayload
      ? {
          barcodes: [
            { format: "PKBarcodeFormatQR", message: ticket.qrPayload, messageEncoding: "iso-8859-1", altText: ticket.code },
          ],
        }
      : {}),
    eventTicket: {
      headerFields: [{ key: "date", label: "DATE", value: passDate(ticket) }],
      primaryFields: [{ key: "event", label: "EVENT", value: ticket.eventTitle }],
      secondaryFields,
      auxiliaryFields,
      backFields,
    },
  };
}

interface ForgeSigner {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  wwdr: forge.pki.Certificate;
}

/** A configured value node-forge can't use, named by its variable (never its value). */
class SignerProblem extends Error {}

function readForSigning<T>(variable: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw new SignerProblem(`${variable} couldn't be read for signing`);
  }
}

/** The configuration's certificates and key as node-forge objects, parsed once per configuration. */
const forgeSigners = new WeakMap<AppleWalletConfig, ForgeSigner>();

function forgeSigner(config: AppleWalletConfig): ForgeSigner {
  let signer = forgeSigners.get(config);
  if (!signer) {
    signer = {
      // forge reads RSA only: an EC certificate (Apple's WWDR G6, say) that node:crypto accepted fails here.
      cert: readForSigning("APPLE_WALLET_CERT_PEM", () => forge.pki.certificateFromPem(config.signerCertPem)),
      // node:crypto has already decrypted it; forge reads the unencrypted PKCS #8 form.
      key: readForSigning(
        "APPLE_WALLET_KEY_PEM",
        () => forge.pki.privateKeyFromPem(config.signerKey.export({ type: "pkcs8", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey,
      ),
      wwdr: readForSigning("APPLE_WALLET_WWDR_PEM", () => forge.pki.certificateFromPem(config.wwdrCertPem)),
    };
    forgeSigners.set(config, signer);
  }
  return signer;
}

/**
 * Why `config` can't sign passes, or undefined when it can: node-forge parses
 * the certificates and key, then signs a test manifest. Done once, before
 * Apple passes are offered, so a configuration node:crypto accepted but
 * forge can't use turns Apple off (logged) instead of failing every pass.
 */
export function appleSignerProblem(config: AppleWalletConfig): string | undefined {
  try {
    const signature = signManifest(config, Buffer.from("{}", "utf8"));
    return signature.length > 0 ? undefined : "APPLE_WALLET_CERT_PEM and APPLE_WALLET_KEY_PEM couldn't sign a test pass";
  } catch (err) {
    return err instanceof SignerProblem ? err.message : "APPLE_WALLET_CERT_PEM and APPLE_WALLET_KEY_PEM couldn't sign a test pass";
  }
}

/**
 * The Apple Wallet configuration from the environment, checked
 * (config.ts) and then proven able to sign (appleSignerProblem); undefined,
 * logged once by variable name, when it isn't. For Deps, which imports this
 * module (and node-forge) only when an APPLE_WALLET_* variable is set.
 */
export function loadAppleWallet(values: Record<string, string | undefined> = process.env, now: number = Date.now()) {
  const config = loadWalletConfig("Apple Wallet", () => appleWalletConfigFromEnv(values, now));
  if (!config) return undefined;
  const problem = appleSignerProblem(config);
  if (problem) {
    console.error(`Apple Wallet passes are off: ${problem}.`);
    return undefined;
  }
  return config;
}

/** The detached PKCS #7 (CMS SignedData) signature over manifest.json, DER. */
export function signManifest(config: AppleWalletConfig, manifest: Buffer, now = new Date()): Buffer {
  const signer = forgeSigner(config);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString("binary"));
  p7.addCertificate(signer.cert);
  p7.addCertificate(signer.wwdr);
  p7.addSigner({
    key: signer.key,
    certificate: signer.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // forge's typings say string; it takes a Date for signingTime.
      { type: forge.pki.oids.signingTime, value: now as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

/** The .pkpass bytes for one ticket. */
export function buildApplePass(config: AppleWalletConfig, ticket: WalletTicket, now = new Date()): Buffer {
  const files: [string, Buffer][] = [["pass.json", Buffer.from(JSON.stringify(applePassJson(config, ticket)), "utf8")]];
  for (const [name, base64] of Object.entries(APPLE_PASS_IMAGES)) files.push([name, Buffer.from(base64, "base64")]);
  const manifest = Buffer.from(
    JSON.stringify(Object.fromEntries(files.map(([name, bytes]) => [name, createHash("sha1").update(bytes).digest("hex")]))),
    "utf8",
  );
  let signature: Buffer;
  try {
    signature = signManifest(config, manifest, now);
  } catch {
    // Never forge's own message: nothing about the key goes anywhere.
    throw new Error("Apple Wallet pass signing failed.");
  }
  return zipStore([...files, ["manifest.json", manifest], ["signature", signature]]);
}
