import type { MetadataRoute } from "next";
import { APP_THEME_COLOR } from "@/lib/pwa/theme";

/**
 * The web app manifest, served at /manifest.webmanifest (Next adds the
 * <link rel="manifest"> itself). See docs/pwa.md. Icons are generated from
 * app/icon.svg; tests/pwa-manifest.test.ts checks every one exists at the
 * size declared here.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sheltüh",
    short_name: "Sheltüh",
    description: "A curated guide to Melbourne's live music, art, workshops and pop-ups. Find what's on and get tickets.",
    lang: "en-AU",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: APP_THEME_COLOR,
    background_color: APP_THEME_COLOR,
    categories: ["entertainment", "lifestyle", "music"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
