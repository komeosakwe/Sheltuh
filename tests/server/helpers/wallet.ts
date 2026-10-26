import { createHash, generateKeyPairSync, verify, X509Certificate, type KeyObject } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import forge from "node-forge";
import { expect } from "vitest";
import { passTimeZone, walletQrPayload, type WalletTicket } from "@/lib/server/wallet/pass-content";

/**
 * Wallet test credentials, made fresh in each test run (never committed, and
 * nothing real): an RSA key pair for a Google service account, and for Apple
 * a self-signed stand-in for Apple's WWDR intermediate that issues a Pass
 * Type ID certificate with Apple's subject layout. Plus independent checks
 * for what the API makes: a zip reader, and a PKCS #7 signature verifier
 * built on node:crypto (forge's DER parser only reads the structure; forge's
 * own signature verification is never used).
 */

export const TEST_ISSUER_ID = "3388000000012345678";
export const TEST_SERVICE_ACCOUNT = "wallet@sheltuh-wallet.iam.gserviceaccount.com";
export const TEST_PASS_TYPE_ID = "pass.au.com.sheltuh.test";
export const TEST_TEAM_ID = "ABCDE12345";

/** A 2048-bit RSA key pair, as PEMs and KeyObjects. */
export function rsaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey,
    publicKey,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** The Google variables, as Vercel holds them: the key with literal `\n` escapes (as in the JSON key file). */
export function googleWalletEnv() {
  const keys = rsaKeyPair();
  return {
    keys,
    env: {
      GOOGLE_WALLET_ISSUER_ID: TEST_ISSUER_ID,
      GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: TEST_SERVICE_ACCOUNT,
      GOOGLE_WALLET_PRIVATE_KEY: keys.privatePem.replace(/\n/g, "\\n"),
    } as Record<string, string | undefined>,
  };
}

const forgeKey = (pem: string) => forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
const forgePublic = (key: KeyObject) => forge.pki.publicKeyFromPem(key.export({ type: "spki", format: "pem" }).toString());

function certificate(options: {
  subject: forge.pki.CertificateField[];
  issuer: forge.pki.CertificateField[];
  publicKey: KeyObject;
  signingKey: string;
  serial: string;
  notBefore: Date;
  notAfter: Date;
  ca: boolean;
}): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublic(options.publicKey);
  cert.serialNumber = options.serial;
  cert.validity.notBefore = options.notBefore;
  cert.validity.notAfter = options.notAfter;
  cert.setSubject(options.subject);
  cert.setIssuer(options.issuer);
  cert.setExtensions([{ name: "basicConstraints", cA: options.ca }]);
  cert.sign(forgeKey(options.signingKey), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const DAY = 24 * 60 * 60 * 1000;
const b64 = (pem: string) => Buffer.from(pem, "utf8").toString("base64");

/**
 * Apple's variables for a test chain: base64 PEMs, as docs/wallet-setup.md
 * has the owner store them. `passphrase` encrypts the key; `expired` dates
 * the certificate in the past; `passTypeId` / `teamId` change what the
 * certificate's subject names.
 */
export function appleWalletEnv(
  options: { passphrase?: string; expired?: boolean; passTypeId?: string; teamId?: string; otherWwdr?: boolean } = {},
) {
  const now = Date.now();
  const wwdrKeys = rsaKeyPair();
  const wwdrSubject = [
    { name: "commonName", value: "Test Worldwide Developer Relations Certification Authority" },
    { shortName: "OU", value: "G4" },
    { name: "organizationName", value: "Sheltuh Test" },
    { name: "countryName", value: "AU" },
  ];
  const wwdrPem = certificate({
    subject: wwdrSubject,
    issuer: wwdrSubject,
    publicKey: wwdrKeys.publicKey,
    signingKey: wwdrKeys.privatePem,
    serial: "01",
    notBefore: new Date(now - 30 * DAY),
    notAfter: new Date(now + 3650 * DAY),
    ca: true,
  });
  const signerKeys = rsaKeyPair();
  const passTypeId = options.passTypeId ?? TEST_PASS_TYPE_ID;
  const signerPem = certificate({
    // Apple's layout: UID (the Pass Type ID), CN, OU (the Team ID), O, C.
    subject: [
      { type: "0.9.2342.19200300.100.1.1", value: passTypeId },
      { name: "commonName", value: `Pass Type ID: ${passTypeId}` },
      { shortName: "OU", value: options.teamId ?? TEST_TEAM_ID },
      { name: "organizationName", value: "Sheltuh Test" },
      { name: "countryName", value: "AU" },
    ],
    issuer: wwdrSubject,
    publicKey: signerKeys.publicKey,
    signingKey: options.otherWwdr ? rsaKeyPair().privatePem : wwdrKeys.privatePem,
    serial: "0a1b2c",
    notBefore: new Date(now - (options.expired ? 400 : 1) * DAY),
    notAfter: new Date(now + (options.expired ? -1 : 365) * DAY),
    ca: false,
  });
  const keyPem = options.passphrase
    ? signerKeys.privateKey
        .export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: options.passphrase })
        .toString()
    : signerKeys.privatePem;
  return {
    wwdrPem,
    signerPem,
    env: {
      APPLE_WALLET_PASS_TYPE_ID: TEST_PASS_TYPE_ID,
      APPLE_WALLET_TEAM_ID: TEST_TEAM_ID,
      APPLE_WALLET_CERT_PEM: b64(signerPem),
      APPLE_WALLET_KEY_PEM: b64(keyPem),
      APPLE_WALLET_WWDR_PEM: b64(wwdrPem),
      ...(options.passphrase ? { APPLE_WALLET_KEY_PASSPHRASE: options.passphrase } : {}),
    } as Record<string, string | undefined>,
  };
}

/** A JWT's three parts, decoded, and whether its RS256 signature verifies with `publicKey`. */
export function decodeJwt(jwt: string, publicKey: KeyObject) {
  const [header, claims, signature] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString("utf8")),
    verified: verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")),
  };
}

/**
 * Every file in a zip, read through its central directory (as Wallet does),
 * checking each entry's local header, sizes and CRC-32.
 */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const raw = zip.subarray(start, start + size);
    const bytes = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(crc32(bytes), name).toBe(crc);
    files.set(name, bytes);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const OID = {
  signedData: "1.2.840.113549.1.7.2",
  data: "1.2.840.113549.1.7.1",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  sha256: "2.16.840.1.101.3.4.2.1",
};

type Node = forge.asn1.Asn1;
const children = (node: Node) => node.value as Node[];
const oidOf = (node: Node) => forge.asn1.derToOid(node.value as string);

/**
 * Verifies a detached PKCS #7 signature over `content`, independently of the
 * code that made it: walks the DER, checks it's SignedData with no content
 * of its own, carries `signer` and `wwdr`, names the signer by issuer and
 * serial, has a messageDigest of SHA-256(content), a contentType and a
 * signingTime, and that the signer's RSA signature over the DER of those
 * attributes (as a SET) verifies; and that `wwdr` issued `signer`.
 */
export function verifyDetachedSignature(signature: Buffer, content: Buffer, signerPem: string, wwdrPem: string) {
  const signer = new X509Certificate(signerPem);
  const wwdr = new X509Certificate(wwdrPem);
  const root = forge.asn1.fromDer(forge.util.createBuffer(signature.toString("binary")));
  const [typeNode, wrapped] = children(root);
  expect(oidOf(typeNode)).toBe(OID.signedData);
  const signedData = children(children(wrapped)[0]);
  const encapContent = signedData.find((n) => n.tagClass === forge.asn1.Class.UNIVERSAL && n.type === forge.asn1.Type.SEQUENCE)!;
  // Detached: the content type only, no content.
  expect(children(encapContent)).toHaveLength(1);
  expect(oidOf(children(encapContent)[0])).toBe(OID.data);

  const certs = signedData.find((n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0)!;
  const carried = children(certs).map((c) => new X509Certificate(Buffer.from(forge.asn1.toDer(c).getBytes(), "binary")));
  expect(carried.map((c) => c.fingerprint256).sort()).toEqual([signer.fingerprint256, wwdr.fingerprint256].sort());

  const signerInfos = signedData.at(-1)!;
  expect(children(signerInfos)).toHaveLength(1);
  const info = children(children(signerInfos)[0]);
  const [, issuerAndSerial, digestAlgorithm] = info;
  const serial = Buffer.from(children(issuerAndSerial)[1].value as string, "binary").toString("hex").toUpperCase();
  expect(serial.replace(/^0+/, "")).toBe(signer.serialNumber.toUpperCase().replace(/^0+/, ""));
  expect(oidOf(children(digestAlgorithm)[0])).toBe(OID.sha256);

  const attributes = info.find((n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0)!;
  const byType = new Map(children(attributes).map((a) => [oidOf(children(a)[0]), children(children(a)[1])[0]]));
  expect(oidOf(byType.get(OID.contentType)!)).toBe(OID.data);
  expect(Buffer.from(byType.get(OID.messageDigest)!.value as string, "binary").toString("hex")).toBe(
    createHash("sha256").update(content).digest("hex"),
  );
  expect(byType.has(OID.signingTime)).toBe(true);

  // The signature covers the attributes' DER with their [0] IMPLICIT tag as a SET (RFC 5652 §5.4).
  const signedAttributes = Buffer.from(forge.asn1.toDer(attributes).getBytes(), "binary");
  signedAttributes[0] = 0x31;
  const rsaSignature = Buffer.from(info.at(-1)!.value as string, "binary");
  expect(verify("sha256", signedAttributes, signer.publicKey, rsaSignature)).toBe(true);
  expect(signer.checkIssued(wwdr) && signer.verify(wwdr.publicKey)).toBe(true);
}

export const TEST_EVENT_ID = "0b6f5f7e-6a52-4c39-9d2a-3b1f0e5d9c11";

/** A ticket's pass content, as the routes build it (lib/server/handlers/wallet.ts). */
export function sampleTicket(overrides: Partial<WalletTicket> = {}): WalletTicket {
  return {
    eventId: TEST_EVENT_ID,
    eventTitle: "Neon Static",
    startsAt: "2027-03-06T09:00:00.000Z",
    endsAt: "2027-03-06T12:30:00.000Z",
    timeZone: passTimeZone(),
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    ticketTypeName: "General admission",
    ticketNumber: 2,
    ticketCount: 3,
    code: "7KQM-2HXD",
    qrPayload: walletQrPayload("7KQM-2HXD"),
    orderReference: "#7C1F2E0A",
    ...overrides,
  };
}
