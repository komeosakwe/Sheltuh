# Maps

Every map on the site is Leaflet with raster tiles: `/map` (`components/SceneMap.tsx`,
`components/SceneMapPanel.tsx`), the event page's Location map
(`components/events/EventLocationLeaflet.tsx`) and the organiser's venue pin step
(`components/dashboard/VenuePinMapLeaflet.tsx`). Which tiles they show is decided in one
place, `lib/map-tiles.ts` (through `components/map/useMapTileStyle.ts`):

- **With a public Mapbox token** in `NEXT_PUBLIC_MAPBOX_TOKEN`: **Mapbox Streets**
  (`mapbox/streets-v12`) on every map, in both the Light and the Dark theme. The tiles come
  from Mapbox's raster
  [Static Tiles API](https://docs.mapbox.com/api/maps/static-tiles/) (512px tiles at `@2x`),
  so there's no Mapbox SDK and no new dependency. The credit reads © Mapbox, © OpenStreetMap
  and "Improve this map", with links.
- **Without a token**, or with one that isn't a public `pk.…` token: Esri's free light-gray
  canvas, which needs no account or key. A secret (`sk.…`) or temporary (`tk.…`) token is
  ignored, so the site falls back to Esri rather than ship it to browsers.

There's no style switch: visitors can't choose a style.

## Setting the token (owner steps)

1. In your Mapbox account → **Tokens** → **Create a token**. Leave it **public** (it starts
   with `pk.`), with only the default public scopes (`styles:tiles` and `styles:read` are
   what the maps use). Tick no secret scopes.
2. Under **URL restrictions**, list the site's own URLs: `https://sheltuh.com.au` (and any
   other domain the site is served on), plus your Vercel preview URLs if previews should
   show Mapbox, and `http://localhost:3000` for local work. A restricted token only works
   on the listed sites, so a copied token is useless elsewhere. On a URL that isn't listed,
   Mapbox refuses the tiles and the map says it couldn't load.
3. In Vercel → Project → Settings → Environment Variables, set `NEXT_PUBLIC_MAPBOX_TOKEN` to
   the `pk.…` token for the environments that should use it, and **redeploy**:
   `NEXT_PUBLIC_` values are fixed when the site is built.
4. **Never use a secret `sk.…` token.** Anything in a `NEXT_PUBLIC_` variable is sent to
   every visitor's browser.

To go back to Esri, delete the variable and redeploy; revoke the token in Mapbox → Tokens if
it's no longer needed.

## Free tier and cost

The Static Tiles API has a monthly free allowance and then charges per 1,000 tile requests.
The current numbers are on [mapbox.com/pricing](https://www.mapbox.com/pricing) (the
**Static Tiles API** line); they weren't checked for this doc, so don't rely on remembered
figures.

What drives cost: every 512px tile is one request. A first view of a map loads a handful of
tiles (more on a large screen), and each pan or zoom loads more. The event page's map loads
only as its section nears the screen. Browsers cache tiles, but each new visitor makes new
requests, and the site's service worker never stores Mapbox tiles (their URLs carry the
token). Set a billing alert or spending limit in Mapbox before launch.

## Mapbox wordmark

Mapbox's [attribution guidelines](https://docs.mapbox.com/help/getting-started/attribution/)
require its wordmark on maps using its styles, as well as the text credit. With Streets
active, `components/map/MapboxLogo.tsx` (rendered inside all three Leaflet maps) shows it
bottom-left as a link to <https://www.mapbox.com/> (new tab, `rel="noopener noreferrer"`,
accessible name "Mapbox"); with Esri it renders nothing. The image is
`public/mapbox-logo.svg`, Mapbox's official wordmark, copied unchanged from the default
`.mapboxgl-ctrl-logo` data URI in **mapbox-gl 3.9.0**'s `dist/mapbox-gl.css` (MIT-licensed
package; fetched from the npm registry tarball, because the jsDelivr CDN was blocked in
the build environment). It is white with a dark outline, so it reads on the Streets map in
both themes. To update it, take the same rule from a newer pinned mapbox-gl release.
Layout: it uses Leaflet's bottom-left control corner (the zoom control is top-left, the
credit bottom-right); where it's shown the credit gets a max width that stops short of it,
and `/map`'s desktop event card sits above it. Like the credit links, it is hidden from
assistive tech and the tab order on the event page's inert, aria-hidden map.

## Tile seams

At a fractional device pixel ratio (Windows display scaling of 125% or 150%, or a zoomed
browser), Chromium can leave a 1px hairline between raster tiles (Leaflet issue #3575;
Leaflet 1.9's own `mix-blend-mode: plus-lighter` fix doesn't cover a whole missing pixel).
`components/map/MapStyles.tsx`, which every map renders, draws each base tile 1 CSS px wider
and taller with normal blending, so neighbouring tiles overlap instead of leaving a gap.

## Tests

- `tests/map-tiles.test.ts`: token rules, Streets with a token and Esri without, tile URLs
  and attribution.
- `tests/MapTiles.test.tsx`: the real Leaflet maps in jsdom (`/map`, the Location map and
  the pin map), with and without the token, in both themes; `/map` has no style control.
- The Mapbox wordmark (shown with a token on all three maps, absent without one) is also
  covered in `tests/MapTiles.test.tsx` and `e2e/mapbox-streets.demo.spec.ts` (visible, and
  clear of the controls and credit at 390 and 1440).
- `e2e/map-tiles.spec.ts` and `e2e/event-page.spec.ts` (live dev server, no token): Esri.
- `e2e/mapbox-streets.demo.spec.ts` (demo build, which `playwright.config.ts` gives a
  placeholder `pk.` token): Mapbox tile requests are intercepted and answered with a small
  image; the specs check every map asks for Streets tiles with the token, in both themes,
  and that tiles meet without a seam at device pixel ratios 1.25 and 1.5.
