import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ID, DEFAULT_APP_SERVER_URL, resolveAppServer } from "@/lib/mobile/app-config";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("resolveAppServer (which site an app build opens)", () => {
  it("is production by default, with the trailing slash iOS's prefix check needs", () => {
    expect(resolveAppServer(undefined)).toEqual({ url: "https://sheltuh.com.au/", cleartext: false });
    expect(resolveAppServer("  ")).toEqual({ url: DEFAULT_APP_SERVER_URL, cleartext: false });
  });

  it.each([
    ["https://preview.sheltuh.com.au", "https://preview.sheltuh.com.au/"],
    ["https://preview.sheltuh.com.au/", "https://preview.sheltuh.com.au/"],
    [" https://Example.com:8443 ", "https://example.com:8443/"],
  ])("accepts the https origin %s", (raw, url) => {
    expect(resolveAppServer(raw)).toEqual({ url, cleartext: false });
  });

  it.each([
    ["http://localhost:3000", "http://localhost:3000/"],
    ["http://127.0.0.1:3177", "http://127.0.0.1:3177/"],
    ["http://10.0.2.2:3000", "http://10.0.2.2:3000/"],
  ])("allows plain http (cleartext) only for a local dev server: %s", (raw, url) => {
    expect(resolveAppServer(raw)).toEqual({ url, cleartext: true });
  });

  it.each([
    ["plain http to a real host", "http://sheltuh.com.au"],
    ["a path", "https://sheltuh.com.au/events"],
    ["a query", "https://sheltuh.com.au/?x=1"],
    ["a fragment", "https://sheltuh.com.au/#x"],
    ["credentials", "https://user:pass@sheltuh.com.au"],
    ["another scheme", "ftp://sheltuh.com.au"],
    ["javascript:", "javascript:alert(1)"],
    ["not a URL", "sheltuh.com.au"],
  ])("refuses %s, naming the variable", (_label, raw) => {
    expect(() => resolveAppServer(raw)).toThrow(/SHELTUH_APP_URL/);
  });
});

describe("capacitor.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig() {
    vi.resetModules();
    return (await import("@/capacitor.config")).default;
  }

  it("opens production, keeps every other site out of the app, and has a fallback page", async () => {
    vi.stubEnv("SHELTUH_APP_URL", "");
    const config = await loadConfig();
    expect(config.appId).toBe(APP_ID);
    expect(config.appName).toBe("Sheltüh");
    expect(config.server?.url).toBe("https://sheltuh.com.au/");
    expect(config.server?.cleartext).toBeUndefined();
    // Only server.url's origin stays inside the app; everything else opens in the system browser.
    expect(config.server?.allowNavigation).toBeUndefined();
    expect(config.android?.allowMixedContent).toBeUndefined();
    const webDir = path.join(ROOT, config.webDir ?? "");
    expect(fs.existsSync(path.join(webDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(webDir, config.server?.errorPath ?? "missing"))).toBe(true);
  });

  it("follows SHELTUH_APP_URL, with cleartext only for a local server", async () => {
    vi.stubEnv("SHELTUH_APP_URL", "http://10.0.2.2:3000");
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://10.0.2.2:3000/");
    expect(config.server?.cleartext).toBe(true);
  });

  it("fails to load with an unsafe SHELTUH_APP_URL, so a sync stops", async () => {
    vi.stubEnv("SHELTUH_APP_URL", "http://evil.example");
    await expect(loadConfig()).rejects.toThrow(/SHELTUH_APP_URL/);
  });
});
