import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import { describe, expect, it } from "vitest";
import { nextConfig } from "@/next.config";
import { BANNER_PHOTO_SIZES, CARD_PHOTO_SIZES, isOptimizablePhoto, responsivePhoto } from "@/lib/responsive-image";

/**
 * Stock photos at the size their box needs (lib/responsive-image.ts), through the image optimizer; an
 * organiser's event photo never goes through it (an optimized copy outlives its takedown: next.config.ts).
 */

const EVENT_PHOTO = "/api/events/5b0e1c8a-3f7d-4e2b-9a61-0c8d7e6f5a4b/image?v=1730000000";

describe("responsivePhoto", () => {
  it("serves the stock photos from the optimizer, as a srcset for the box's sizes", () => {
    const src = "/events/street-market.jpg";
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
  });

  it("leaves anything else as it is: a published event's photo, no sizes, an upload's object URL, another site's photo", () => {
    expect(responsivePhoto("/events/street-market.jpg", undefined)).toEqual({ src: "/events/street-market.jpg" });
    for (const src of [
      EVENT_PHOTO,
      "/api/events/5b0e1c8a-3f7d-4e2b-9a61-0c8d7e6f5a4b/image",
      "blob:http://localhost/1234",
      "https://example.com/photo.jpg",
      "/events/../secret.jpg",
      "/events/photo.svg",
      "/events/here-and-now/story-card",
      "/events/Photo.JPG",
      "/events/photo.Webp",
    ]) {
      expect(isOptimizablePhoto(src)).toBe(false);
      expect(responsivePhoto(src, BANNER_PHOTO_SIZES)).toEqual({ src });
    }
  });
});

describe("the image optimizer's paths (next.config.ts images.localPatterns)", () => {
  const patterns = nextConfig.images?.localPatterns;

  it("takes the stock photo files in public/events and public/home", () => {
    for (const src of [
      "/events/street-market.jpg",
      "/events/jazz-drummer.webp",
      "/events/photo.jpeg",
      "/events/photo.png",
      "/home/people/person-1.webp",
    ]) {
      expect(hasLocalMatch(patterns, src), src).toBe(true);
    }
  });

  it("refuses an event's photo route, an app route, a query string and anything that isn't an image file", () => {
    for (const src of [
      "/api/events/x/image?v=1",
      EVENT_PHOTO,
      "/api/events/5b0e1c8a-3f7d-4e2b-9a61-0c8d7e6f5a4b/image",
      "/events/x/story-card",
      "/events/here-and-now",
      "/events/x/photo.jpg",
      "/events/street-market.jpg?v=1",
      "/home/people/person-1.webp?x=1",
      "/events/photo.svg",
      "/home",
      "/home/people",
      "/api/organisers/x/cover?size=small",
    ]) {
      expect(hasLocalMatch(patterns, src), src).toBe(false);
    }
  });

  it("every photo responsivePhoto sends to the optimizer is one it takes (an upper-case extension is neither)", () => {
    for (const src of [
      "/events/street-market.jpg",
      "/events/Street-Market.jpg",
      "/events/photo.jpeg",
      "/events/photo.png",
      "/events/jazz-drummer.webp",
      "/events/Photo.JPG",
      "/events/photo.JPEG",
      "/events/photo.PNG",
      "/events/photo.Webp",
    ]) {
      expect(isOptimizablePhoto(src), src).toBe(hasLocalMatch(patterns, src));
    }
    expect(hasLocalMatch(patterns, "/events/Photo.JPG")).toBe(false);
    expect(responsivePhoto("/events/Photo.JPG", CARD_PHOTO_SIZES)).toEqual({ src: "/events/Photo.JPG" });
  });

  it("serves AVIF or WebP, and keeps each copy at least an hour", () => {
    expect(nextConfig.images?.minimumCacheTTL).toBe(3600);
    expect(nextConfig.images?.formats).toEqual(["image/avif", "image/webp"]);
  });
});
