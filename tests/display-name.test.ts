import { describe, expect, it } from "vitest";
import { displayNameLength, endSentence, validateDisplayName } from "@/lib/display-name";

describe("validateDisplayName", () => {
  it.each(["Mia T.", "Émile", "स्त्री", "李小龍", "Mia ❤️", "  Mia  ", `M${"é".repeat(39)}`])("accepts %j", (name) => {
    expect(validateDisplayName(name)).toBeNull();
  });

  it.each([
    ["", "Enter a display name."],
    ["   ", "Enter a display name."],
    ["🎉🎉", "Display names need at least one letter or number."],
    ["...", "Display names need at least one letter or number."],
    ["Mia​T", "Display names can't contain invisible or control characters."],
    ["Mia‮gnp", "Display names can't contain invisible or control characters."],
    ["Mia⠀", "Display names can't contain invisible or control characters."],
    ["Mia\tT", "Display names can't contain invisible or control characters."],
    ["a".repeat(41), "Keep it to 40 characters or fewer."],
  ])("rejects %j", (name, message) => {
    expect(validateDisplayName(name)).toBe(message);
  });

  it("counts code points after collapsing spaces, as the API does", () => {
    expect(displayNameLength("🎉".repeat(40))).toBe(40);
    expect(displayNameLength("  Mia    T.  ")).toBe(6);
    expect(validateDisplayName(`Mia${"🎉".repeat(37)}`)).toBeNull();
    expect(validateDisplayName(`Mia${"🎉".repeat(38)}`)).toBe("Keep it to 40 characters or fewer.");
  });
});

describe("endSentence", () => {
  it("adds a full stop unless the name already ends a sentence", () => {
    expect(endSentence("Mia")).toBe("Mia.");
    expect(endSentence("Mia T.")).toBe("Mia T.");
    expect(endSentence("Yes!")).toBe("Yes!");
  });
});
