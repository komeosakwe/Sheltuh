import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { APP_THEME_COLOR } from "@/lib/pwa/theme";

const ROOT = path.resolve(import.meta.dirname, "..");
const ORIGIN = "https://app.sheltuh.com.au";

/** Width, height and colour type from a PNG's IHDR chunk (no image library needed). */
function readPng(file: string) {
  const bytes = readFileSync(file);
  const signature = bytes.subarray(0, 8).toString("hex");
  expect(signature, `${file} is not a PNG`).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    // 2 = RGB, 6 = RGBA (see the PNG spec, IHDR).
    colourType: bytes.readUInt8(25),
  };
}

const m = manifest();

describe("web app manifest", () => {
  it("names the app and opens standalone at the site root", () => {
    expect(m.name).toBe("Sheltüh");
    expect(m.short_name).toBe("Sheltüh");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
    expect(m.categories).toEqual(expect.arrayContaining(["entertainment"]));
  });

  it("keeps start_url and id on this site and inside the scope", () => {
    for (const value of [m.start_url, m.id]) {
      const url = new URL(String(value), ORIGIN);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname.startsWith(String(m.scope))).toBe(true);
    }
  });

  it("uses the paper colour from the design tokens for theme and background", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const paper = css.match(/--background:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(paper).toBeDefined();
    expect(APP_THEME_COLOR.toLowerCase()).toBe(paper?.toLowerCase());
    expect(m.theme_color).toBe(APP_THEME_COLOR);
    expect(m.background_color).toBe(APP_THEME_COLOR);
  });

  it("declares a 192px and a 512px icon, plus a separate maskable 512px icon", () => {
    const icons = m.icons ?? [];
    const any = icons.filter((icon) => icon.purpose === "any");
    expect(any.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    const maskable = icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable.map((icon) => icon.sizes)).toEqual(["512x512"]);
    // A combined "any maskable" icon would show the padded artwork as a plain icon.
    expect(icons.some((icon) => String(icon.purpose).includes(" "))).toBe(false);
  });

  it.each((m.icons ?? []).map((icon) => [icon.src, icon] as const))(
    "%s exists in public/ and is the size it declares",
    (src, icon) => {
      expect(src.startsWith("/")).toBe(true);
      const file = path.join(ROOT, "public", src);
      expect(existsSync(file), `${file} is missing`).toBe(true);
      expect(icon.type).toBe("image/png");
      const { width, height } = readPng(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
    },
  );

  it("has an opaque full-bleed maskable icon (platforms crop it to their own shape)", () => {
    const { colourType } = readPng(path.join(ROOT, "public/icons/icon-maskable-512.png"));
    expect(colourType).toBe(2);
  });
});

describe("apple-touch-icon (app/apple-icon.png)", () => {
  it("is a 180px opaque PNG, since iOS fills transparency with black and rounds the corners itself", () => {
    const file = path.join(ROOT, "app/apple-icon.png");
    expect(existsSync(file)).toBe(true);
    const { width, height, colourType } = readPng(file);
    expect([width, height]).toEqual([180, 180]);
    expect(colourType).toBe(2);
  });
});
