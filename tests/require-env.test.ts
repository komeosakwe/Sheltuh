import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnv } from "@/lib/server/deps";

describe("requireEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("trims a pasted space or line break around the value", () => {
    vi.stubEnv("SHELTUH_TEST_SECRET", "  whsec_abc123\n");
    expect(requireEnv("SHELTUH_TEST_SECRET")).toBe("whsec_abc123");
  });

  it("refuses a missing or whitespace-only value, naming the variable", () => {
    vi.stubEnv("SHELTUH_TEST_SECRET", " \n ");
    expect(() => requireEnv("SHELTUH_TEST_SECRET")).toThrow("Missing required environment variable: SHELTUH_TEST_SECRET");
  });
});
