import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { ticketQrPng } from "@/lib/server/qr-image";

// The ticket-offer email's QR placeholder (public/email/ticket/qr-locked.png,
// scripts/render-ticket-qr-locked.ts) must never decode: it stands in for a
// QR the recipient only gets once they accept. A real ticket QR decodes with
// the same reader, so the check isn't vacuous.

const root = path.resolve(import.meta.dirname, "../..");

prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(path.join(root, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm")).buffer as ArrayBuffer,
  },
});

async function decode(png: Buffer): Promise<string[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { data: new Uint8ClampedArray(data), width: info.width, height: info.height, colorSpace: "srgb" as const };
  const results = await readBarcodes(image, { formats: ["QRCode"], tryHarder: true, tryInvert: true, tryRotate: true });
  return results.filter((r) => r.isValid).map((r) => r.text);
}

describe("the locked QR placeholder", () => {
  it("a real ticket QR decodes with this reader", async () => {
    const real = ticketQrPng("7KQM-2HXD");
    expect(real).not.toBeNull();
    expect(await decode((real as { png: Buffer }).png)).toEqual(["SH1:7KQM-2HXD"]);
  });

  it("qr-locked.png decodes to nothing, at its own contrast and stretched to black and white", async () => {
    const file = readFileSync(path.join(root, "public/email/ticket/qr-locked.png"));
    expect(await decode(file)).toEqual([]);
    const contrasted = await sharp(file).greyscale().threshold(250).png().toBuffer();
    expect(await decode(contrasted)).toEqual([]);
  });
});
