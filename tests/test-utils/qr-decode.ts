import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

/**
 * A real QR decoder for tests: ZXing-C++ compiled to WebAssembly (the
 * `zxing-wasm` reader, which `barcode-detector`, the door scanner's
 * dependency, is built on). The `.wasm` is read from node_modules, so
 * nothing is fetched.
 */

let ready: Promise<unknown> | null = null;

function zxingReady(): Promise<unknown> {
  if (!ready) {
    const entry = createRequire(import.meta.url).resolve("zxing-wasm/reader");
    // dist/cjs/reader/index.js -> dist/reader/zxing_reader.wasm
    const wasm = readFileSync(path.resolve(path.dirname(entry), "../../reader/zxing_reader.wasm"));
    const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    ready = prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
  }
  return ready;
}

/**
 * Every QR code ZXing reads in an encoded image (PNG bytes), as text. No
 * "try harder" or rotations: what a plain scan of the image gives.
 */
export async function decodeQrImage(image: Uint8Array): Promise<string[]> {
  await zxingReady();
  const results = await readBarcodes(image, { formats: ["QRCode"], tryHarder: false, tryRotate: false, tryInvert: false });
  return results.filter((r) => r.isValid).map((r) => r.text);
}
