import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";
import { locateZxingFile } from "@/lib/check-in/detector";

/**
 * The door scanner's self-hosted WASM (public/vendor/zxing-wasm/): the file
 * the installed barcode-detector expects, at the URL the detector asks for,
 * with its licence notices. A dependency bump without copying the new .wasm
 * fails here instead of at the door.
 */
const root = path.resolve(import.meta.dirname, "..");
const folder = path.join(root, "public", "vendor", "zxing-wasm", ZXING_WASM_VERSION);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };

describe("vendored zxing WASM", () => {
  it("pins barcode-detector to an exact version", () => {
    expect(pkg.dependencies["barcode-detector"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the exact binary the installed library expects, in a folder named for its version", () => {
    const wasm = readFileSync(path.join(folder, "zxing_reader.wasm"));
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(ZXING_WASM_SHA256);
  });

  it("is what the detector points the loader at (our origin, not the CDN)", () => {
    const url = locateZxingFile(ZXING_WASM_VERSION, "zxing_reader.wasm", "https://cdn.example/");
    expect(url).toBe(`/vendor/zxing-wasm/${ZXING_WASM_VERSION}/zxing_reader.wasm`);
    expect(existsSync(path.join(root, "public", url))).toBe(true);
    // Anything that isn't the .wasm keeps Emscripten's own location.
    expect(locateZxingFile(ZXING_WASM_VERSION, "other.data", "/prefix/")).toBe("/prefix/other.data");
  });

  it("ships with the MIT and Apache-2.0 notices", () => {
    expect(readFileSync(path.join(folder, "LICENSE-barcode-detector.txt"), "utf8")).toMatch(/MIT License/);
    expect(readFileSync(path.join(folder, "LICENSE-zxing-wasm.txt"), "utf8")).toMatch(/MIT License/);
    expect(readFileSync(path.join(folder, "LICENSE-zxing-cpp.txt"), "utf8")).toMatch(/Apache License\s+Version 2\.0/);
    expect(readFileSync(path.join(folder, "LICENSE-zxing-wasm-cpp.txt"), "utf8")).toMatch(/Apache License\s+Version 2\.0/);
    expect(readFileSync(path.join(folder, "README.txt"), "utf8")).toContain(ZXING_WASM_SHA256);
  });
});
