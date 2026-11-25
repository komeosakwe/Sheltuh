import { describe, expect, it } from "vitest";
import { nextConfig } from "@/next.config";
import { BANNER_PHOTO_SIZES, CARD_PHOTO_SIZES, isOptimizablePhoto, responsivePhoto } from "@/lib/responsive-image";

/** Event photos at the size their box needs (lib/responsive-image.ts), through the image optimizer. */

const EVENT_PHOTO = "/api/events/5b0e1c8a-3f7d-4e2b-9a61-0c8d7e6f5a4b/image?v=1730000000";

describe("responsivePhoto", () => {
  it("serves a published event's photo and the stock photos from the optimizer, as a srcset for the box's sizes", () => {
    for (const src of [EVENT_PHOTO, "/events/street-market.jpg"]) {
      const photo = responsivePhoto(src, CARD_PHOTO_SIZES);
      expect(photo.sizes).toBe(CARD_PHOTO_SIZES);
      const candidates = (photo.srcSet ?? "").split(", ");
      expect(candidates.length).toBeGreaterThan(3);
      for (const candidate of candidates) {
        expect(candidate).toMatch(new RegExp(`^/_next/image\\?url=${encodeURIComponent(src).replace(/[.?]/g, "\\$&")}&w=\\d+&q=75 \\d+w$`));
      }
      // A small phone's copy is there (not only full-screen desktop widths).
      expect(candidates.some((c) => / 640w$/.test(c))).toBe(true);
      expect(photo.src).toMatch(/^\/_next\/image\?url=/);
    }
  });

  it("leaves anything else as it is: no sizes, an upload's object URL, another site's photo, a draft's unversioned route", () => {
    expect(responsivePhoto(EVENT_PHOTO, undefined)).toEqual({ src: EVENT_PHOTO });
    for (const src of [
      "blob:http://localhost/1234",
      "https://example.com/photo.jpg",
      "/api/events/5b0e1c8a-3f7d-4e2b-9a61-0c8d7e6f5a4b/image",
      "/api/events/not-an-id/image?v=1",
      "/events/../secret.jpg",
      "/events/photo.svg",
    ]) {
      expect(isOptimizablePhoto(src)).toBe(false);
      expect(responsivePhoto(src, BANNER_PHOTO_SIZES)).toEqual({ src });
    }
  });

  it("the optimizer accepts exactly those paths (next.config.ts images.localPatterns), and keeps a copy no longer than the photo's own hour", () => {
    expect(nextConfig.images?.localPatterns).toEqual([
      { pathname: "/api/events/*/image" },
      { pathname: "/events/**", search: "" },
      { pathname: "/home/**", search: "" },
    ]);
    expect(nextConfig.images?.minimumCacheTTL).toBe(3600);
    expect(nextConfig.images?.formats).toEqual(["image/avif", "image/webp"]);
  });
});
