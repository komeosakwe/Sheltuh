import { createHash, randomBytes } from "node:crypto";

/** An offer link's token: 32 random bytes, base64url (43 characters). */
export const TRANSFER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new offer link token, minted per email attempt by the outbox worker. Never stored or logged: only its hash. */
export function newTransferToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What private.ticket_transfer_tokens stores for `token`: SHA-256, hex. */
export function hashTransferToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
