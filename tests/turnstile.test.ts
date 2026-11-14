// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCaptchaFailure, loadTurnstile, TURNSTILE_SCRIPT_URL, turnstileSiteKey, type TurnstileApi } from "@/lib/auth/turnstile";

const api: TurnstileApi = { render: () => "w1", reset: () => {}, remove: () => {} };

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script")].filter((s) => s.src === TURNSTILE_SCRIPT_URL);
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, "turnstile");
  for (const script of scripts()) script.remove();
});

describe("turnstileSiteKey", () => {
  it("is the trimmed NEXT_PUBLIC_TURNSTILE_SITE_KEY, or undefined when unset or blank", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", " 0x4AAAAAAAexample ");
    expect(turnstileSiteKey()).toBe("0x4AAAAAAAexample");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  ");
    expect(turnstileSiteKey()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    expect(turnstileSiteKey()).toBeUndefined();
  });
});

describe("loadTurnstile", () => {
  it("adds Cloudflare's script once for concurrent calls, and resolves both when it loads", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);
    window.turnstile = api;
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
    // Loaded: no new script.
    await expect(loadTurnstile()).resolves.toBe(api);
    expect(scripts()).toHaveLength(1);
  });

  it("rejects when the script fails to load, removes it, and a later call tries again", async () => {
    const attempt = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(attempt).rejects.toThrow("Cloudflare Turnstile couldn't be loaded.");
    expect(scripts()).toEqual([]);
    void loadTurnstile().catch(() => {});
    expect(scripts()).toHaveLength(1);
  });

  it("rejects when the script loaded but defined no window.turnstile", async () => {
    const attempt = loadTurnstile();
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(attempt).rejects.toThrow();
    expect(scripts()).toEqual([]);
  });
});

describe("isCaptchaFailure", () => {
  it.each([
    [{ message: "anything", code: "captcha_failed" }, true],
    [{ message: "captcha protection: request disallowed (no captcha response)" }, true],
    [{ message: "Invalid login credentials", code: "invalid_credentials" }, false],
  ])("%j → %s", (error, expected) => {
    expect(isCaptchaFailure(error)).toBe(expected);
  });
});
