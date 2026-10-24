import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Keys for anonymous rate limits (docs/architecture.md, "Reserved seating":
 * the per-client seat-hold limit; "Payment flow": the paid checkout and
 * payment page limits). The raw IP address (or order id) never leaves this
 * module: callers get a keyed SHA-256 of it, and only that is stored.
 */

/**
 * The client's IP address as our hosting saw it, or undefined when there's no
 * usable header. On Vercel both `x-forwarded-for` and `x-real-ip` are set by
 * the platform (an incoming `x-forwarded-for` is overwritten, not appended
 * to, so a client can't spoof it): the first hop of `x-forwarded-for`, else
 * `x-real-ip`. Anything that isn't an IP address is ignored. Behind another
 * proxy that appends to `x-forwarded-for` instead, the first hop would be
 * client-controlled: revisit this before hosting anywhere else.
 */
export function clientIp(req: Request): string | undefined {
  const candidates = [req.headers.get("x-forwarded-for")?.split(",")[0], req.headers.get("x-real-ip")];
  for (const candidate of candidates) {
    const ip = normaliseIp(candidate?.trim() ?? "");
    if (ip) return ip;
  }
  return undefined;
}

/**
 * One client, one key: an IPv4 address as is; an IPv6 address by its /64
 * (one household or phone usually has a whole /64, so keying on the full
 * address would let it rotate through endless keys); an IPv4-mapped IPv6
 * address as its IPv4 address. Undefined for anything that isn't an IP.
 */
export function normaliseIp(value: string): string | undefined {
  const ip = value.replace(/%.*$/, ""); // an IPv6 zone id ("fe80::1%eth0") says nothing about the client
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return undefined;
  let host: string;
  try {
    // The WHATWG URL parser canonicalises IPv6 (lowercase, compressed, an embedded IPv4 as hex).
    host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
  const [head, tail] = host.split("::");
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups =
    tail === undefined ? front : [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back];
  if (groups.length !== 8) return undefined;
  const words = groups.map((g) => parseInt(g, 16));
  if (words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return undefined;
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join(".");
  }
  return `${words.slice(0, 4).map((w) => w.toString(16)).join(":")}::/64`;
}

/** Labels the salt so it can't be confused with anything else derived from the same secret. */
const SALT_CONTEXT = "sheltuh/client-key/v1";
/** The same, for order keys: a different salt, so an order key never equals a client key. */
const ORDER_SALT_CONTEXT = "sheltuh/order-key/v1";

function keyedHash(context: string, value: string, secret: string): string {
  const salt = createHmac("sha256", secret).update(context, "utf8").digest();
  return createHmac("sha256", salt).update(value, "utf8").digest("hex");
}

/**
 * The stored key for a client: HMAC-SHA256 (a salted SHA-256) of the
 * normalised IP address, 64 hex characters. The salt is derived from a
 * server secret (`secret`, which the database never sees), so a database
 * reader can't recover addresses by hashing all 2^32 IPv4 addresses.
 * Rotating the secret only starts every client's counters afresh.
 */
export function clientKey(ip: string, secret: string): string {
  return keyedHash(SALT_CONTEXT, ip, secret);
}

/**
 * The stored key for a per-order counter (the payment page's per-order
 * limit): HMAC-SHA256 of the order id, salted as clientKey but under its own
 * label, 64 hex characters. The order id is a bearer credential, so it's
 * never stored in a counter itself; the key can't be turned back into it.
 */
export function orderKey(orderId: string, secret: string): string {
  return keyedHash(ORDER_SALT_CONTEXT, orderId, secret);
}
