import { describe, expect, it } from "vitest";
import { firstName } from "@/lib/person-name";

describe("firstName", () => {
  it("is the first word of a name, or the whole of a one-word name", () => {
    expect(firstName("Alex Chen")).toBe("Alex");
    expect(firstName("  Zoë   van der Berg ")).toBe("Zoë");
    expect(firstName("李小龍")).toBe("李小龍");
  });
});
