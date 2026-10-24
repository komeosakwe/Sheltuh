# Mapbox preview on /map

The map on `/map` uses Leaflet with Esri's free light-gray tiles
(`docs/PROJECT_CONTEXT.md`: "Mapbox only if custom styling is needed"). To
decide whether Mapbox is worth it, a **preview switch** lets you see Mapbox
styles on the real site, over the same Leaflet map, markers and list. It needs
no new dependency: it loads Mapbox's raster
[Static Tiles API](https://docs.mapbox.com/api/maps/static-tiles/).

**Without a token, nothing changes.** If `NEXT_PUBLIC_MAPBOX_TOKEN` is unset
or empty, `/map` uses Esri as before, shows no switch, and ignores `?tiles=`.
Production is unaffected unless you add the token there.

Code: `lib/map-tiles.ts` (styles, URLs, attribution, which style shows),
`components/map/useMapTileStyle.ts`, `components/map/MapStylePreview.tsx`,
and `components/SceneMapPanel.tsx`.

## What the preview does

With a token set, `/map` shows a **Map style (preview)** dropdown above the
map:

| Choice | Value for `?tiles=` | Mapbox style |
| --- | --- | --- |
| Current (Esri) | `esri` | (today's Esri map) |
| Mapbox Light (monochrome) | `mapbox-light` | `mapbox/light-v11` |
| Mapbox Dark | `mapbox-dark` | `mapbox/dark-v11` |
| Mapbox Streets | `mapbox-streets` | `mapbox/streets-v12` |
| Sheltüh custom (Mapbox Studio) | `mapbox-custom` | your `NEXT_PUBLIC_MAPBOX_STYLE` (only when set) |

- **Default:** Mapbox Light in the Light theme, or your custom style if you
  set one. Mapbox Dark in the Dark theme.
- **Sharing:** the chosen style goes in the address, for example
  `/map?tiles=mapbox-dark`, so you can send someone a link.
- **Remembered:** the choice is stored in this browser
  (`localStorage["sheltuh:map-tiles"]`). An explicit choice or `?tiles=`
  overrides the theme's default.
- Mapbox has no public "monochrome" style id. Light is its greyscale style
  and the closest to the brand. Studio's **Monochrome** template is a starting
  point for a custom style (see below).

## Turning it on (owner steps)

1. **Create a Mapbox account** at [mapbox.com](https://www.mapbox.com/). A card
   may be needed even for the free tier.
2. **Create a public token:** Account → **Tokens** → **Create a token**.
   - Leave it as a **public** token. It starts with `pk.`.
   - Leave only the default public scopes ticked (`styles:tiles` and
     `styles:read` are what the preview uses). Tick no secret scopes.
   - Under **URL restrictions**, add every origin that will show the map:
     your Vercel preview domain and `https://app.sheltuh.com.au` (plus
     `http://localhost:3000` if you want it locally). Vercel preview URLs
     change with each deployment, so use the branch's stable alias, such as
     `https://<project>-git-<branch>-<team>.vercel.app`, or check in Mapbox's
     token page whether a wildcard pattern is accepted for your domain. A
     restricted token only works on the listed sites, so a copied token is
     useless elsewhere.
   - **Never use a secret `sk.` token.** Anything in a `NEXT_PUBLIC_`
     variable is sent to every visitor's browser. The app ignores tokens
     that don't start with `pk.`, so the switch won't appear.
3. **Add it to Vercel's Preview environment only:** Project → Settings →
   Environment Variables → `NEXT_PUBLIC_MAPBOX_TOKEN` = your `pk.…` token,
   with only **Preview** ticked (not Production).
4. **Redeploy the preview.** `NEXT_PUBLIC_` values are fixed when the site is
   built, so existing deployments won't pick up the token. Then open
   `/map` on the preview URL.
5. Optional: **custom Sheltüh style.** In
   [Mapbox Studio](https://studio.mapbox.com/), create a style (the
   Monochrome or Light template is a good start) and publish it. Copy its
   style URL `mapbox://styles/<username>/<styleid>`, and set
   `NEXT_PUBLIC_MAPBOX_STYLE` = `<username>/<styleid>` in Preview. Redeploy.
   It appears as "Sheltüh custom (Mapbox Studio)" and becomes the Light
   default.

If the map shows "Map couldn't load" on a Mapbox style, the token is probably
refused. Check that the page's origin is in the token's URL restrictions.
Esri still works from the dropdown.

## Free tier and cost

I couldn't check Mapbox's current numbers from this environment, so confirm
them on [mapbox.com/pricing](https://www.mapbox.com/pricing) (look for the
**Static Tiles API** line). Historically, the Static Tiles API has had a
monthly free allowance (in the order of 200,000 tile requests), then a
per-1,000 charge. Treat those numbers as unverified.

What drives cost:

- Every 512px tile is one request. A first view of the map at desktop size
  loads roughly 6–12 tiles, and each pan or zoom loads more. So a free
  allowance in the low hundreds of thousands covers thousands of map
  sessions a month, not millions.
- Browsers cache tiles, but each new visitor is new requests. The site's
  service worker never stores Mapbox tiles (their URLs carry the token).
- Set a **billing alert** or spending limit in your Mapbox account before
  using it in Production.

Compared with Esri: today's Esri tiles cost nothing and need no account or
key, but offer no styling control. Mapbox costs money past the free tier but
lets the map match the brand (fonts, colours, which labels show). The
PROJECT_CONTEXT position ("Mapbox only if custom styling is needed") still
holds. This preview is for judging whether the styling is worth it.

## Before using Mapbox in Production

- Mapbox's [attribution guidelines](https://docs.mapbox.com/help/getting-started/attribution/)
  also ask for the **Mapbox wordmark** on maps that use its styles. The
  preview only shows the text attribution (© Mapbox, © OpenStreetMap,
  Improve this map). Add the wordmark before going live.
- Decide whether Esri stays as a fallback or the switch goes away. Today the
  switch appears wherever the token is set, including Production, and
  defaults to Mapbox.

## Removing it

- **Turn it off:** delete `NEXT_PUBLIC_MAPBOX_TOKEN` (and
  `NEXT_PUBLIC_MAPBOX_STYLE`) in Vercel and redeploy. The site goes back to
  Esri with no switch. Revoke the token in Mapbox → Tokens.
- **Remove the code:** delete `lib/map-tiles.ts`'s Mapbox parts,
  `components/map/useMapTileStyle.ts` and `components/map/MapStylePreview.tsx`,
  pass Esri to `SceneMapPanel` as before, drop the `tiles` URL parameter in
  `components/SceneMap.tsx`, and remove the tests
  (`tests/map-tiles.test.ts`, `tests/MapStylePreview.test.tsx`,
  `e2e/map-tiles.spec.ts`, `e2e/mapbox-preview.demo.spec.ts`) and the
  placeholder token in `playwright.config.ts`.

## Tests

- `tests/map-tiles.test.ts`: token rules, style list, tile URLs, attribution,
  and which style shows.
- `tests/MapStylePreview.test.tsx`: the real map in jsdom, with and without
  the token.
- `e2e/map-tiles.spec.ts` (live dev server, no token): `/map` is unchanged.
  The page requests Esri tiles only and shows no switch.
- `e2e/mapbox-preview.demo.spec.ts` (demo build, which `playwright.config.ts`
  gives a placeholder `pk.` token, as a Vercel preview with the token would
  have): Mapbox tile requests are intercepted and answered with a small
  image, and the spec checks that the requested URLs follow the chosen style.
