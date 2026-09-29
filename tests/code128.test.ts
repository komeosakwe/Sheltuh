import { describe, expect, it } from "vitest";
import { encodeCode128B } from "@/lib/barcode/code128";

// Expected modules generated independently with the JsBarcode library (CODE128B).
const REFERENCE: [string, string][] = [
  ["ABCD-EFGH", "11010010000101000110001000101100010001000110101100010001001101110010001101000100011000101101000100011000101000110110001101100011101011"],
  ["A2B3-C4D5", "11010010000101000110001100111001010001011000110010111001001101110010001000110110010011101011000100011011100100100110001001100011101011"],
  ["Z9Z9-Y8Y8", "11010010000111011000101110010110011101100010111001011001001101110011101101000111010011001110110100011101001100100111100101100011101011"],
  ["HELLO", "110100100001100010100010001101000100011011101000110111010001110110110001010001100011101011"],
  ["0123456789", "1101001000010011101100100111001101100111001011001011100110010011101101110010011001110100111011011101110100110011100101100110000101001100011101011"],
  ["K7M2-QW3R", "11010010000101100011101110110111010111011000110011100101001101110011010001110111010001101100101110011000101110111101000101100011101011"],
];

describe("encodeCode128B", () => {
  it.each(REFERENCE)("encodes %s exactly like a reference implementation", (text, expected) => {
    expect(encodeCode128B(text)).toBe(expected);
  });

  it("produces 11 modules per symbol plus a 13-module stop", () => {
    const text = "ABCD-EFGH";
    // start + data + checksum symbols, then the stop pattern.
    expect(encodeCode128B(text)).toHaveLength(11 * (1 + text.length + 1) + 13);
  });

  it("starts with the start-B pattern and ends with the stop pattern", () => {
    const modules = encodeCode128B("K7M2-QW3R");
    expect(modules.startsWith("11010010000")).toBe(true);
    expect(modules.endsWith("1100011101011")).toBe(true);
  });

  it("rejects text Code 128B can't represent", () => {
    expect(() => encodeCode128B("")).toThrow();
    expect(() => encodeCode128B("ü")).toThrow();
  });
});
