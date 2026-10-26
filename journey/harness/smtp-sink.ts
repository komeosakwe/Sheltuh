import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { inflateSync } from "node:zlib";

/**
 * A tiny local SMTP server that captures what the app's real SMTP sender
 * (nodemailer, lib/server/email.ts) delivers. It requires AUTH (PLAIN or
 * LOGIN) with the configured credentials before MAIL, as Google Workspace
 * does, so a sender that forgot to authenticate fails here too. No TLS: it
 * listens on 127.0.0.1 only and never relays anything anywhere.
 *
 * `rejectData` makes it answer DATA with a 451, to simulate an outage.
 */

export interface CapturedMail {
  authUser: string;
  mailFrom: string;
  rcptTo: string[];
  /** The message exactly as received (dot-unstuffed). */
  raw: string;
}

export class SmtpSink {
  readonly messages: CapturedMail[] = [];
  /** While true, DATA is refused with a temporary failure (451). */
  rejectData = false;
  port = 0;
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  private waiters: { match: (m: CapturedMail) => boolean; resolve: (m: CapturedMail) => void }[] = [];

  constructor(
    private readonly user: string,
    private readonly pass: string,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((socket) => this.session(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  /** Messages delivered to `address` so far. */
  to(address: string): CapturedMail[] {
    return this.messages.filter((m) => m.rcptTo.includes(address.toLowerCase()));
  }

  /** The first message (already received or yet to come) matching `match`; rejects after `timeoutMs`. */
  waitFor(match: (m: CapturedMail) => boolean, timeoutMs = 15_000): Promise<CapturedMail> {
    const found = this.messages.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve: (m: CapturedMail) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`No matching email within ${timeoutMs} ms (${this.messages.length} captured).`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private deliver(mail: CapturedMail) {
    this.messages.push(mail);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(mail)) {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        waiter.resolve(mail);
      }
    }
  }

  private session(socket: Socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const send = (line: string) => socket.write(`${line}\r\n`);
    let buffer = "";
    let authUser: string | null = null;
    let pendingLogin: "plain" | "user" | "pass" | null = null;
    let loginUser = "";
    let mailFrom: string | null = null;
    let rcptTo: string[] = [];
    let data: string[] | null = null;

    const checkAuth = (user: string, pass: string) => {
      if (user === this.user && pass === this.pass) {
        authUser = user;
        send("235 2.7.0 Authentication successful");
      } else {
        send("535 5.7.8 Authentication credentials invalid");
      }
    };

    const checkPlain = (encoded: string) => {
      const [, user, pass] = Buffer.from(encoded, "base64").toString("utf8").split("\0");
      checkAuth(user ?? "", pass ?? "");
    };

    const command = (line: string) => {
      if (data) {
        if (line === ".") {
          const raw = data.join("\r\n") + "\r\n";
          data = null;
          if (this.rejectData) {
            send("451 4.3.0 Sink is refusing mail (simulated outage)");
          } else {
            this.deliver({ authUser: authUser!, mailFrom: mailFrom!, rcptTo, raw });
            send("250 2.0.0 OK queued");
          }
          mailFrom = null;
          rcptTo = [];
        } else {
          data.push(line.startsWith("..") ? line.slice(1) : line);
        }
        return;
      }
      if (pendingLogin === "plain") {
        pendingLogin = null;
        checkPlain(line);
        return;
      }
      if (pendingLogin) {
        const value = Buffer.from(line, "base64").toString("utf8");
        if (pendingLogin === "user") {
          loginUser = value;
          pendingLogin = "pass";
          send("334 UGFzc3dvcmQ6");
        } else {
          pendingLogin = null;
          checkAuth(loginUser, value);
        }
        return;
      }
      const verb = line.split(" ")[0].toUpperCase();
      switch (verb) {
        case "EHLO":
          send("250-sink.localhost");
          send("250-AUTH PLAIN LOGIN");
          send("250 8BITMIME");
          return;
        case "HELO":
          send("250 sink.localhost");
          return;
        case "AUTH": {
          const [, mechanism, initial] = line.split(" ");
          if (mechanism?.toUpperCase() === "PLAIN") {
            if (!initial) {
              pendingLogin = "plain";
              send("334 ");
              return;
            }
            checkPlain(initial);
          } else if (mechanism?.toUpperCase() === "LOGIN") {
            if (initial) {
              loginUser = Buffer.from(initial, "base64").toString("utf8");
              pendingLogin = "pass";
              send("334 UGFzc3dvcmQ6");
            } else {
              pendingLogin = "user";
              send("334 VXNlcm5hbWU6");
            }
          } else {
            send("504 5.5.4 Unrecognized authentication type");
          }
          return;
        }
        case "MAIL":
          if (!authUser) {
            send("530 5.7.0 Authentication required");
            return;
          }
          mailFrom = (line.match(/<([^>]*)>/)?.[1] ?? "").toLowerCase();
          rcptTo = [];
          send("250 2.1.0 OK");
          return;
        case "RCPT":
          if (!mailFrom) {
            send("503 5.5.1 MAIL first");
            return;
          }
          rcptTo.push((line.match(/<([^>]*)>/)?.[1] ?? "").toLowerCase());
          send("250 2.1.5 OK");
          return;
        case "DATA":
          if (!mailFrom || rcptTo.length === 0) {
            send("503 5.5.1 RCPT first");
            return;
          }
          data = [];
          send("354 End data with <CR><LF>.<CR><LF>");
          return;
        case "RSET":
          mailFrom = null;
          rcptTo = [];
          send("250 2.0.0 OK");
          return;
        case "NOOP":
          send("250 2.0.0 OK");
          return;
        case "QUIT":
          send("221 2.0.0 Bye");
          socket.end();
          return;
        default:
          send("502 5.5.2 Command not implemented");
      }
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        command(line);
      }
    });
    send("220 sink.localhost ESMTP journey sink");
  }
}

// ---------------------------------------------------------------------------
// MIME: just enough to read what nodemailer sends (multipart/alternative and
// multipart/related; base64, quoted-printable, 7bit and 8bit parts).
// ---------------------------------------------------------------------------

export interface MimePart {
  headers: Map<string, string>;
  contentType: string;
  /** The Content-ID without angle brackets, if any. */
  contentId?: string;
  body: Buffer;
}

export interface ParsedMail {
  headers: Map<string, string>;
  subject: string;
  /** Every leaf part, depth first. */
  parts: MimePart[];
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = block.replace(/\r\n[ \t]+/g, " ");
  for (const line of unfolded.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function headerParam(value: string, name: string): string | undefined {
  const match = value.match(new RegExp(`;\\s*${name}="?([^";]+)"?`, "i"));
  return match?.[1];
}

function decodeQuotedPrintable(text: string): Buffer {
  const soft = text.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(soft[i], "utf8"));
    }
  }
  return Buffer.from(bytes);
}

/** RFC 2047 encoded words (=?UTF-8?B?…?= / =?UTF-8?Q?…?=), as nodemailer writes non-ASCII subjects. */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, _charset: string, enc: string, text: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQuotedPrintable(text.replace(/_/g, " ")).toString("utf8"),
    );
}

function parseEntity(entity: string, out: MimePart[]) {
  const split = entity.indexOf("\r\n\r\n");
  const headers = parseHeaders(split >= 0 ? entity.slice(0, split) : entity);
  const body = split >= 0 ? entity.slice(split + 4) : "";
  const contentType = (headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
  if (contentType.startsWith("multipart/")) {
    const boundary = headerParam(headers.get("content-type") ?? "", "boundary");
    if (!boundary) throw new Error("multipart without a boundary");
    const sections = body.split(`--${boundary}`);
    // sections[0] is the preamble; the last one starts with "--" (the closing delimiter).
    for (const section of sections.slice(1)) {
      if (section.startsWith("--")) break;
      parseEntity(section.replace(/^\r\n/, "").replace(/\r\n$/, ""), out);
    }
    return;
  }
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit").toLowerCase();
  const decoded =
    encoding === "base64"
      ? Buffer.from(body.replace(/\s+/g, ""), "base64")
      : encoding === "quoted-printable"
        ? decodeQuotedPrintable(body)
        : Buffer.from(body, "utf8");
  const cid = headers.get("content-id")?.replace(/^<|>$/g, "");
  out.push({ headers, contentType, ...(cid ? { contentId: cid } : {}), body: decoded });
}

export function parseMail(raw: string): ParsedMail {
  const split = raw.indexOf("\r\n\r\n");
  const headers = parseHeaders(raw.slice(0, split));
  const parts: MimePart[] = [];
  parseEntity(raw, parts);
  return { headers, subject: decodeEncodedWords(headers.get("subject") ?? ""), parts };
}

// ---------------------------------------------------------------------------
// PNG → QR modules: an independent reading of the ticket QR's pixels.
// ---------------------------------------------------------------------------

/** PNG's Paeth predictor (filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const pa = Math.abs(b - c);
  const pb = Math.abs(a - c);
  const pc = Math.abs(a + b - 2 * c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a non-interlaced 1-bit greyscale PNG (what lib/server/png.ts makes) to dark/light pixels; throws on anything else. */
export function decodePng(png: Buffer): { width: number; height: number; dark: boolean[][] } {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [bitDepth, colourType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (bitDepth !== 1 || colourType !== 0 || interlace !== 0) {
        throw new Error(`Unsupported PNG (bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace})`);
      }
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8);
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    // bpp rounds up to 1 byte for bit depth 1.
    for (let i = 0; i < stride; i++) {
      const a = i > 0 ? line[i - 1] : 0;
      const b = prev[i];
      const c = i > 0 ? prev[i - 1] : 0;
      const add =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : filter === 4 ? paeth(a, b, c)
        : NaN;
      if (Number.isNaN(add)) throw new Error(`Bad PNG filter ${filter}`);
      line[i] = (line[i] + add) & 0xff;
    }
    rows.push(line);
    prev = line;
  }
  const dark = rows.map((line) => Array.from({ length: width }, (_, x) => (line[x >> 3] & (0x80 >> (x & 7))) === 0));
  return { width, height, dark };
}

/**
 * Reads the QR modules off a rendered symbol: finds the top-left finder
 * pattern (its 7-module dark top edge gives the module size), then samples
 * the centre of every module. Knows nothing about how the image was made.
 */
export function qrModulesFromPng(png: Buffer): boolean[][] {
  const { width, height, dark } = decodePng(png);
  if (width !== height) throw new Error("A QR image is square");
  let top = -1;
  let left = -1;
  for (let y = 0; y < height && top < 0; y++) {
    const x = dark[y].indexOf(true);
    if (x >= 0) [top, left] = [y, x];
  }
  if (top < 0) throw new Error("No dark pixels");
  let run = 0;
  while (dark[top][left + run]) run++;
  if (run % 7 !== 0) throw new Error(`Finder edge of ${run}px isn't 7 modules`);
  const scale = run / 7;
  const size = (width - 2 * left) / scale;
  if (!Number.isInteger(size) || top !== left) throw new Error("The symbol isn't centred in a uniform quiet zone");
  return Array.from({ length: size }, (_, my) =>
    Array.from({ length: size }, (_, mx) => dark[top + my * scale + (scale >> 1)][left + mx * scale + (scale >> 1)]),
  );
}
