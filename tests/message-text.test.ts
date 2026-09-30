import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, messageLength, normaliseMessage, RAW_INPUT_CAP, validateMessage } from "@/lib/message-text";

describe("message text", () => {
  it("normalises like the API: CRLF, trailing spaces per line, blank-line runs, outer whitespace", () => {
    expect(normaliseMessage("  hi  \r\n\r\n\r\n\r\nthere \t\n")).toBe("hi\n\nthere");
    expect(normaliseMessage("a \t \nb")).toBe("a\nb");
  });

  it("counts code points after normalising (an emoji is one)", () => {
    expect(messageLength("  😀  ")).toBe(1);
    expect(messageLength("é".repeat(MESSAGE_MAX))).toBe(MESSAGE_MAX);
  });

  it("validates blank, too long, control and text-direction characters", () => {
    expect(validateMessage("   \n ")).toBe("Write a message.");
    expect(validateMessage("hello")).toBeNull();
    expect(validateMessage("x".repeat(MESSAGE_MAX))).toBeNull();
    expect(validateMessage("x".repeat(MESSAGE_MAX + 1))).toBe("Keep it to 1,000 characters or fewer.");
    expect(validateMessage(`evil${String.fromCodePoint(0x202e)}txt`)).toMatch(/text-direction/);
    expect(validateMessage(`bell${String.fromCodePoint(7)}`)).toMatch(/control/);
    expect(validateMessage("tab\tand\nnewline")).toBeNull();
    expect(validateMessage("", { optional: true })).toBeNull();
    expect(validateMessage("…", { label: "Details", optional: true })).toBeNull();
    expect(validateMessage("   ", { label: "Details", optional: true })).toBeNull();
  });

  it("refuses invisible format characters like the API, but keeps emoji joiners and flag tag sequences", () => {
    const invisible = "Messages can't contain control, invisible or text-direction characters.";
    for (const cp of [0x200b, 0x200e, 0x200f, 0x00ad, 0xfeff, 0x2060, 0x2028]) {
      expect(validateMessage(`hi${String.fromCodePoint(cp)}there`)).toBe(invisible);
    }
    expect(validateMessage(`x${String.fromCodePoint(0x200b)}`, { label: "Details", optional: true })).toBe(
      "Details can't contain control, invisible or text-direction characters.",
    );
    const technologist = String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb);
    const england = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
    expect(validateMessage(`coding ${technologist} in ${england}`)).toBeNull();
    // A stray tag character outside a flag sequence is still refused.
    expect(validateMessage(`x${String.fromCodePoint(0xe0067)}`)).toBe(invisible);
  });

  it("stays fast on huge or adversarial input (no quadratic whitespace handling)", () => {
    const spaces = " ".repeat(200_000) + "x";
    const started = performance.now();
    expect(normaliseMessage(spaces)).toBe("x");
    expect(validateMessage(spaces)).toBe("Keep it to 1,000 characters or fewer.");
    expect(messageLength(spaces)).toBe(spaces.length);
    expect(performance.now() - started).toBeLessThan(500);
    // Refused before any cleaning past the API's raw limit (4,000 UTF-16 units), even if trimming would fit it.
    expect(RAW_INPUT_CAP).toBe(4000);
    expect(validateMessage("hi" + " ".repeat(RAW_INPUT_CAP))).toBe("Keep it to 1,000 characters or fewer.");
    expect(validateMessage("hi" + " ".repeat(RAW_INPUT_CAP - 2))).toBeNull();
  });
});
