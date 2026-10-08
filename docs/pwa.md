# Installable web app (PWA)

Status: Phase 1 (installable web app). There is no native wrapper (Capacitor):
that is a separate, later phase that has not been started.

This page explains what the PWA layer does, what it deliberately does not do,
and how to switch it off. **Read the caching design before you change
`public/sw.js`.**

## What's in it

| Piece | File | Notes |
| --- | --- | --- |
| Web app manifest | `app/manifest.ts` → `/manifest.webmanifest` | Next metadata route. Next adds the `<link rel="manifest">` itself. |
| Icons | `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `app/apple-icon.png` (180) | Generated from `app/icon.svg` (see "Regenerating the icons"). |
| iOS / theme metadata | `app/layout.tsx` (`metadata.appleWebApp`, `viewport`) | `theme-color` #f3f0e8, `viewport-fit=cover`, status bar `default`. |
| Safe areas | `app/globals.css`, `components/Nav.tsx`, `components/Footer.tsx`, `components/SceneMap.tsx` (+ the buy bar, composer and menu bottom, which already had them) | Every `env(safe-area-inset-*)` is 0 on desktop, so desktop is unchanged. |

`viewport-fit=cover` supersedes the "don't add it in this pass" note in
`docs/design/mobile.md` §3.0 and §5. Its concern (landscape notch gutters on
every page) is handled once: the body pads with
`env(safe-area-inset-left/right)`, which reproduces the letterboxing Safari
did before, and the viewport-fixed menu and map card pad themselves. The
header pads with the top inset, the footer and the existing sticky bars with
the bottom inset.
| Service worker | `public/sw.js` | Hand-written, no library. |
| Registration + kill switch | `lib/pwa/service-worker.ts`, `components/pwa/ServiceWorkerRegistration.tsx` | Production builds on HTTPS only. |
| Offline page | `public/offline.html` | Self-contained static HTML with inline CSS, so it renders without any JS or CSS bundle. |
| Install affordance | `components/pwa/InstallPrompt.tsx`, `lib/pwa/install.ts` | In the footer, on browsing pages only. |

## Caching design

Principle: **the service worker caches public, content-hashed build output and
public images, and nothing else.** No HTML page, API response or third-party
response is ever written to a cache. Anything a user might consider private
is "not cacheable" by default, and nothing private is cacheable in this
design.

### What is cached

| Cache name | What | Strategy | Bound | Invalidation |
| --- | --- | --- | --- | --- |
| `sheltuh-shell-v1` | `/offline.html` only | Precached on `install` (fetched with `cache: "reload"`) | 1 entry | Replaced when `VERSION` changes; old caches deleted on `activate` |
| `sheltuh-static-v1` | Same-origin `GET /_next/static/**` (JS, CSS and the self-hosted `next/font` files under `/_next/static/media`). These URLs are content-hashed, so a new deploy uses new URLs | Cache first, network on a miss | 150 entries, 30 days per entry | Oldest entries trimmed after each write; entries older than 30 days are refetched; whole cache dropped on a `VERSION` change |
| `sheltuh-images-v1` | Same-origin `GET` image requests (`request.destination === "image"`, image file extension) outside `/api` and `/_next/image`: `public/` images, icons, the favicon and apple icon | Stale-while-revalidate | 60 entries, 7 days per entry | As above |

A response is only stored when **all** of these hold: it is `200 OK`, it is
same-origin (`type: "basic"`), its `Cache-Control` doesn't contain `no-store`
or `private`, the request has no `Authorization` header, and it isn't a range
request. Each stored response is stamped with an `x-sw-cached-at` header so
the age limit can be enforced.

### What is never cached (and never intercepted)

The service worker doesn't call `respondWith()` for these, so the browser
handles them exactly as it would without a service worker:

- **`/api/**`**, including the checkout, orders (ticket codes), messages,
  Who's Going, profile, admin and Stripe webhook routes, navigations to
  `/api` included.
- **Any cross-origin request**: Supabase (auth, REST, storage, including
  organiser-uploaded event images), Stripe (Checkout, Connect), Esri map tiles,
  anything else.
- **Same-origin paths that look like a Supabase API** (`/auth/v1`, `/rest/v1`,
  `/storage/v1`, `/realtime/v1`, `/functions/v1`, `/supabase*`) in case one
  is ever proxied through this origin.
- **`/_next/image`** (it can proxy remote images, so it isn't treated as a
  public asset).
- **React Server Component and data fetches** (`?_rsc=`, `RSC: 1` requests,
  client-side `fetch()` to anything that isn't a static asset).
- **Every non-`GET` request.**
- `/sw.js` and `/manifest.webmanifest`.

### Navigations (HTML pages)

**Network only, with an offline fallback, and never stored.** For a page
navigation the worker calls `fetch()` and returns the response as-is. If the
fetch *rejects* (no connection), it returns the precached `/offline.html`
instead. Pages are never written to a cache, so signed-in pages (account,
dashboard, admin, messages, checkout confirmation) can't be served from
storage to the next person using the device.

There is no timeout: a slow connection waits for the real page (for example
on the return from Stripe Checkout) rather than flashing the offline page.

### Credentials, tokens, messages, payments, tickets

- The service worker never sees them at rest: it stores no API responses and
  no pages, and it doesn't touch `localStorage`, cookies or IndexedDB.
- The Supabase session is still kept by `@supabase/supabase-js` in
  `localStorage` (existing behaviour, `lib/supabase/browser.ts`); this work
  doesn't change it.
- Because nothing private is cached, there is nothing to wipe on sign-out and
  nothing extra exposed on a lost device beyond what the browser already holds.

### Offline: what works, what doesn't, what people see

| Situation | What happens |
| --- | --- |
| Opening the app or any link with no connection | The offline page: what doesn't work, where your tickets are, a "Try again" link that reloads the page you wanted. |
| A page already on screen when the connection drops | It stays on screen. Anything that needs the server (loading events, Who's Going, sending a message, checkout, ticket codes) fails with that screen's existing error message. |
| Browsing, search, map, event details | Need a connection. |
| Buying tickets, Stripe Checkout | Needs a connection. Nothing is queued. |
| Your tickets / ticket codes | Need a connection (`/checkout/success`, account). The confirmation email lists the codes, and an email app may have it saved offline. |
| Messages | Need a connection to read or send. A typed draft stays in the box on screen; it is not sent later. |
| First visit ever, or browser storage cleared | No service worker yet, so the browser's own offline error appears. |

iOS may delete a site's storage (service worker caches included) when the
site hasn't been used for a while (see Sources). The app always rebuilds from
the network, so the only effect is that the offline page may not be
available until the next online visit.

### Updates: no surprise reloads

- The worker **doesn't** call `skipWaiting()` or `clients.claim()`. A new
  version installs in the background and only takes over once every tab or
  home-screen window using the old version has closed. The page is never
  reloaded by the service worker, so a checkout in progress or a message
  being typed is never interrupted.
- That's safe because the worker serves pages straight from the network: a
  new deploy's HTML (and its new hashed assets) is used on the next
  navigation even while the old worker is still in charge.
- `register("/sw.js", { updateViaCache: "none" })` makes the browser revalidate
  `sw.js` itself on every update check (navigations, and at least every 24h).
- **Changing `public/sw.js`:** bump `VERSION` whenever the cache layout or
  the precached files change, so `activate` deletes the old caches.

## Kill switch

Two levels, both documented here so they can be used without reading the code.

1. **Stop registering, remove existing workers (normal off switch).** Set
   `NEXT_PUBLIC_DISABLE_SERVICE_WORKER=1` for the Production environment in
   Vercel and redeploy. On their next page load, visitors' browsers
   unregister any Sheltüh service worker and delete every `sheltuh-*` cache
   (`lib/pwa/service-worker.ts`). Remove the variable and redeploy to switch
   it back on.
2. **Emergency (a broken worker that stops pages loading).** Replace the
   contents of `public/sw.js` with the worker below and deploy. Browsers
   fetch `sw.js` on their next navigation (it bypasses the HTTP cache), and
   this version activates immediately, deletes every `sheltuh-*` cache,
   stops intercepting anything and unregisters itself. It doesn't reload any
   page.

   ```js
   // Kill switch: remove caches and unregister. Intercepts nothing.
   self.addEventListener("install", () => self.skipWaiting());
   self.addEventListener("activate", (event) => {
     event.waitUntil(
       (async () => {
         const keys = await caches.keys();
         await Promise.all(keys.filter((k) => k.startsWith("sheltuh-")).map((k) => caches.delete(k)));
         await self.registration.unregister();
       })(),
     );
   });
   ```

   Keep it deployed for a few weeks (people who don't open the app for a while
   only pick it up on their next visit), then restore the normal worker.

## Install affordance

`components/pwa/InstallPrompt.tsx`, rendered at the top of the footer.

- **Where it can appear:** `/`, `/events`, `/map`, `/search`, `/about`,
  `/help`, `/partners` only (an allow-list in `lib/pwa/install.ts`). Never on
  an event page (ticket selector and buy bar), checkout, messages, sign-in,
  sign-up, account, dashboard or admin.
- **Never when already installed** (`display-mode: standalone` or iOS
  `navigator.standalone`).
- **Android / Chrome:** shown only after the browser fires
  `beforeinstallprompt` (that is, Chrome considers the app installable). The
  event's default is prevented so Chrome's own mini-infobar doesn't appear
  over the page; "Install" calls `prompt()`. If the person declines in
  Chrome's dialog, that counts as "No thanks".
- **iOS Safari:** short Add to Home Screen steps. Only in Safari on iPhone and
  iPad, not in Chrome, Firefox or Edge for iOS, or in in-app browsers
  (Instagram, Facebook and the like), where the steps would be wrong.
- **No thanks** is remembered in `localStorage` (`sheltuh:install-dismissed`)
  for that browser, permanently. Storage failures (private mode, blocked
  storage) are caught and only mean the choice lasts for that page view.
- No animation, 44px+ targets, real buttons with visible labels, and focus
  moves to a short confirmation after dismissing.

## Testing locally

- Registration needs a production build on HTTPS, so `next dev` and
  `next start` on `http://localhost` never register the worker. That is
  intentional.
- `tests/service-worker.test.ts` runs the real `public/sw.js` in a sandbox
  with fake `caches`/`fetch` and checks what is and isn't cached.
- `e2e/pwa.spec.ts` registers `/sw.js` by hand on the local dev server
  (`127.0.0.1` counts as a secure context) and checks, in a real Chromium at
  desktop and 375px (`phone-375` project): the manifest, icons and head
  tags; the offline page; that the caches hold the offline page, hashed
  assets and an icon but no `/api` response or page; that an offline
  navigation shows the offline page; and the footer install offer (44px
  targets, No thanks remembered). It doesn't prove anything about Safari, a
  real device or real install UI.
- `tests/InstallPrompt.test.tsx`, `tests/pwa-install.test.ts` and
  `tests/pwa-manifest.test.ts` cover the install rules, registration and kill
  switch, and the manifest and icon files.

## Regenerating the icons

The PNGs are rendered from the same artwork as `app/icon.svg` (black square,
orange "ü") with `sharp`, which Next already installs. The glyph is drawn
with the system's Arial-compatible bold font, so check the output by eye
after regenerating on another machine. From the repo root:

```js
// node regenerate-icons.mjs  (run from the repo root; not committed)
import sharp from "sharp";
const glyph = (size, scale) => `
  <text x="${size / 2}" y="${size / 2 + size * 0.22 * scale}" text-anchor="middle"
    font-family="'Arial Narrow', Oswald, Arial, sans-serif" font-weight="700"
    font-size="${size * 0.625 * scale}" fill="#e15b27">&#252;</text>`;
const svg = (size, { rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" ${rounded ? `rx="${size * 14 / 64}"` : ""} fill="#0b0b0e"/>${glyph(size, scale)}</svg>`;
const out = [
  ["public/icons/icon-192.png", 192, { rounded: true, scale: 1 }],
  ["public/icons/icon-512.png", 512, { rounded: true, scale: 1 }],
  // Maskable: full bleed and opaque; the glyph already sits well inside the
  // 40%-radius safe zone (its farthest corner is about 26% from the centre).
  ["public/icons/icon-maskable-512.png", 512, { rounded: false, scale: 1 }],
  // iOS masks its own corners and turns transparency black: full bleed, opaque.
  ["app/apple-icon.png", 180, { rounded: false, scale: 1 }],
];
for (const [file, size, opts] of out) {
  const img = sharp(Buffer.from(svg(size, opts)));
  await (opts.rounded ? img : img.flatten({ background: "#0b0b0e" }).removeAlpha()).png({ compressionLevel: 9 }).toFile(file);
}
```

`tests/pwa-manifest.test.ts` checks that every manifest icon exists and has
the size it declares.

## Sources

Read on 2026-10-08. Several official sites (web.dev, developer.mozilla.org,
developer.chrome.com, webkit.org, w3.org) were blocked by the network policy
of the environment this was written in, so points from them are marked
"search snippet only": the claim was seen in search results for that page, but
the page itself wasn't read. Treat those as unverified until someone reads the
page.

| Point | Source | Status |
| --- | --- | --- |
| `app/manifest.ts` metadata route; `MetadataRoute.Manifest`; manifest is cached by default | Next.js 16.3.5 docs in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `02-guides/progressive-web-apps.md` | Read (local) |
| `app/apple-icon.png` file convention → `<link rel="apple-touch-icon">` | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md` | Read (local) |
| `viewport.themeColor`, `viewportFit`, `interactiveWidget`; viewport fields merge per key across layouts | `.../04-functions/generate-viewport.md`; `node_modules/next/dist/lib/metadata/resolve-metadata.js` (`mergeViewport`) | Read (local) |
| `appleWebApp` emits `mobile-web-app-capable`, title, status bar style | `.../04-functions/generate-metadata.md`; `node_modules/next/dist/lib/metadata/metadata.js` | Read (local) |
| Next recommends `Cache-Control: no-cache` and a JS content type for `/sw.js` | `.../02-guides/progressive-web-apps.md` §8 | Read (local) |
| iOS/iPadOS 26: any website can become a web app | [Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes) ("Added support for any website to become a web app on iOS or iPadOS.") | Read (Apple JSON API) |
| Manifest `id` supported; third-party iOS browsers can Add to Home Screen; Web Push for Home Screen web apps; Lockdown Mode disables service workers | [Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes) | Read (Apple JSON API) |
| `apple-touch-icon` PNG, `sizes`, iOS picks the closest size | [Safari Web Content Guide: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) (archived, last updated 2016-12-12) | Read; archived, may be out of date |
| iOS 26 "Open as Web App" toggle in the Add to Home Screen sheet | [heise online](https://heise.de/-10749652) (third party) | Search snippet only; not an Apple source |
| Chrome install criteria: HTTPS, manifest with name/short_name, 192 and 512 icons, start_url, display; engagement heuristic | [web.dev: install criteria](https://web.dev/articles/install-criteria) | Search snippet only |
| `preventDefault()` on `beforeinstallprompt` suppresses Chrome's mini-infobar (Chrome 76+) | [Chrome for Developers: mini-infobar update](https://developer.chrome.com/blog/mini-infobar-update) | Search snippet only |
| `BeforeInstallPromptEvent` is non-standard; `prompt()` needs a user gesture and works once per event; `userChoice.outcome` is `accepted`/`dismissed` | [MDN: BeforeInstallPromptEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent) | Search snippet only |
| Maskable icon safe zone: circle of radius 40% of the icon width | [web.dev: maskable icons](https://web.dev/articles/maskable-icon) | Search snippet only |
| Waiting worker activates only when no client uses the old one; `skipWaiting()`/`clients.claim()` trade-offs | [web.dev: service worker lifecycle](https://web.dev/articles/service-worker-lifecycle) | Search snippet only |
| `env(safe-area-inset-*)` is 0 unless `viewport-fit=cover` and the screen has insets | [MDN: env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env) | Search snippet only |
| Safari may delete script-writable storage after 7 days without use; Home Screen web apps have their own counter | 2020 WebKit announcement as reported by [Michael Tsai](https://mjtsai.com/blog/2020/03/26/safari-13-1-third-party-cookie-blocking-and-7-day-script-writeable-storage/), [WebKit bug 232302](https://bugs.webkit.org/show_bug.cgi?id=232302) | Unverified against current WebKit docs |

### Unverified (check on a real device)

- Whether iOS honours `mobile-web-app-capable` (Next no longer emits the older
  `apple-mobile-web-app-capable`). The manifest's `display: "standalone"`
  and iOS 26's default "Open as Web App" should make it irrelevant.
- With status bar style `default`, iOS standalone apps are expected to lay
  out below the status bar (`safe-area-inset-top` = 0). The header pads with
  `env(safe-area-inset-top)` in case that's wrong.
- How the iOS keyboard interacts with the messages composer's
  `env(safe-area-inset-bottom)` padding now that `viewport-fit=cover` makes
  it non-zero.
- Whether Chrome on Android still shows a mini-infobar at all in current
  versions (we prevent it either way).
