/**
 * QR detection for the door scanner (docs/design/check-in.md §5.A3).
 *
 * Uses the browser's own BarcodeDetector when it can read QR codes (Chrome on
 * Android). Otherwise (iPhone Safari, Firefox, most desktops) it loads the
 * `barcode-detector` ponyfill (ZXing-C++ compiled to WebAssembly) with a
 * dynamic import, so only this page ever downloads it, and points the
 * `.wasm` at our own copy under public/vendor/zxing-wasm/<version>/ instead
 * of the library's default CDN: no third-party request at the door.
 */

/** Where a decoded code sits in the frame, in the source's pixels. */
export interface DetectedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedCode {
  rawValue: string;
  boundingBox: DetectedBox;
}

/** What the scanner needs: decode the current video frame. */
export interface QrDetector {
  /** "native" or "wasm" (for diagnostics and tests). */
  readonly kind: "native" | "wasm";
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

/** The scanner couldn't load (the import or the WASM failed): "The scanner couldn't load". */
export class ScannerLoadError extends Error {
  constructor(cause: unknown) {
    super("The QR scanner couldn't load.", { cause });
    this.name = "ScannerLoadError";
  }
}

/** The self-hosted folder (public/vendor/zxing-wasm/). The version is appended. */
export const ZXING_WASM_BASE = "/vendor/zxing-wasm";

/** The URL Emscripten should fetch `file` from: our copy for the `.wasm`, its own default otherwise. */
export function locateZxingFile(version: string, file: string, prefix: string): string {
  return file.endsWith(".wasm") ? `${ZXING_WASM_BASE}/${version}/${file}` : prefix + file;
}

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

interface NativeDetectorConstructor {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

function isNativeConstructor(value: unknown): value is NativeDetectorConstructor {
  return typeof value === "function" && typeof Reflect.get(value, "getSupportedFormats") === "function";
}

/** The browser's own detector, if it has one that reads QR codes. Never throws. */
async function nativeDetector(): Promise<QrDetector | null> {
  const candidate: unknown = typeof globalThis === "undefined" ? undefined : Reflect.get(globalThis, "BarcodeDetector");
  if (!isNativeConstructor(candidate)) return null;
  try {
    const formats = await candidate.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    const detector = new candidate({ formats: ["qr_code"] });
    return { kind: "native", detect: (source) => detector.detect(source) };
  } catch {
    return null;
  }
}

async function wasmDetector(): Promise<QrDetector> {
  try {
    const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");
    // Before the constructor: it starts fetching the .wasm straight away.
    // fireImmediately makes a failed download reject here, not on the first frame.
    await prepareZXingModule({
      overrides: { locateFile: (file: string, prefix: string) => locateZxingFile(ZXING_WASM_VERSION, file, prefix) },
      fireImmediately: true,
    });
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    return { kind: "wasm", detect: (source) => detector.detect(source) };
  } catch (error) {
    throw new ScannerLoadError(error);
  }
}

let pending: Promise<QrDetector> | null = null;

/**
 * A QR detector: native if possible, else the WASM fallback. Loaded once per
 * page; a failed load is forgotten so "Try again" really tries again.
 * Rejects with ScannerLoadError.
 */
export function loadQrDetector(): Promise<QrDetector> {
  if (!pending) {
    pending = (async () => (await nativeDetector()) ?? (await wasmDetector()))();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
