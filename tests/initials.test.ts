import { describe, expect, it } from "vitest";
import { initialsFor } from "@/lib/initials";

describe("initialsFor", () => {
  it.each([
    ["Mia T.", "MT"],
    ["mia thompson", "MT"],
    ["Mia", "M"],
    ["  Mia   van der Berg  ", "MB"],
    ["Émile Zola", "ÉZ"],
    ["Émile", "É".normalize("NFD")], // a decomposed accent stays with its letter
    ["山田 太郎", "山太"],
    ["Ngaio 🎸", "N"], // a trailing emoji word is skipped
    ["🎸 Mia", "·"],
    ["", "·"],
    ["   ", "·"],
  ])("%j → %j", (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });
});
