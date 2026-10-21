import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/check-in/detector.ts: native BarcodeDetector when it reads QR codes,
 * otherwise the ponyfill, pointed at our own .wasm before it's constructed.
 */
const ponyfill = {
  prepare: vi.fn(),
  construct: vi.fn(),
};

vi.mock("barcode-detector/ponyfill", () => ({
  ZXING_WASM_VERSION: "9.9.9",
  prepareZXingModule: (...args: unknown[]) => ponyfill.prepare(...args),
  BarcodeDetector: class {
    constructor(options: unknown) {
      ponyfill.construct(options);
    }
    detect() {
      return Promise.resolve([{ rawValue: "SH1:7KQM-2HXD", boundingBox: { x: 0, y: 0, width: 1, height: 1 } }]);
    }
  },
}));

async function freshDetectorModule() {
  vi.resetModules();
  return import("@/lib/check-in/detector");
}

beforeEach(() => {
  ponyfill.prepare.mockReset().mockResolvedValue({});
  ponyfill.construct.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadQrDetector", () => {
  it("uses the browser's own detector when it supports qr_code, and never loads the WASM", async () => {
    const created: unknown[] = [];
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        static getSupportedFormats = async () => ["qr_code", "ean_13"];
        constructor(options: unknown) {
          created.push(options);
        }
        detect = async () => [];
      },
    );
    const { loadQrDetector } = await freshDetectorModule();
    const detector = await loadQrDetector();
    expect(detector.kind).toBe("native");
    expect(created).toEqual([{ formats: ["qr_code"] }]);
    expect(ponyfill.prepare).not.toHaveBeenCalled();
  });

  it("falls back to the WASM ponyfill when the native one can't read QR codes, with the .wasm self-hosted", async () => {
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        static getSupportedFormats = async () => ["ean_13"];
      },
    );
    const { loadQrDetector } = await freshDetectorModule();
    const detector = await loadQrDetector();
    expect(detector.kind).toBe("wasm");
    const options = ponyfill.prepare.mock.calls[0][0] as {
      fireImmediately: boolean;
      overrides: { locateFile: (file: string, prefix: string) => string };
    };
    expect(options.fireImmediately).toBe(true);
    expect(options.overrides.locateFile("zxing_reader.wasm", "https://fastly.jsdelivr.net/")).toBe(
      "/vendor/zxing-wasm/9.9.9/zxing_reader.wasm",
    );
    // Prepared before construction (the constructor starts the download).
    expect(ponyfill.prepare.mock.invocationCallOrder[0]).toBeLessThan(ponyfill.construct.mock.invocationCallOrder[0]);
    expect(ponyfill.construct).toHaveBeenCalledWith({ formats: ["qr_code"] });
  });

  it("rejects with ScannerLoadError when the WASM fails, and tries again next time", async () => {
    const { loadQrDetector, ScannerLoadError } = await freshDetectorModule();
    ponyfill.prepare.mockRejectedValueOnce(new Error("404"));
    await expect(loadQrDetector()).rejects.toBeInstanceOf(ScannerLoadError);
    const detector = await loadQrDetector();
    expect(detector.kind).toBe("wasm");
    expect(ponyfill.prepare).toHaveBeenCalledTimes(2);
  });

  it("loads once per page", async () => {
    const { loadQrDetector } = await freshDetectorModule();
    const [a, b] = await Promise.all([loadQrDetector(), loadQrDetector()]);
    expect(a).toBe(b);
    expect(ponyfill.prepare).toHaveBeenCalledTimes(1);
  });
});
