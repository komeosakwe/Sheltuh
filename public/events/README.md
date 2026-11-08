Drop event photos here as `<slug>.jpg` (e.g. `neon-static.jpg`), ideally square, ~1200px,
then reference it from `lib/sample-photos.ts` (`PHOTO_BY_SLUG` or `LIVE_MUSIC_PHOTOS`).
Sample events without a listed photo show the generated poster art. Only use images you have the rights to.

## Photo sources

Record where every photo came from and its licence here before deploying. A photo whose
metadata shows a stock-library credit (Getty/iStock) at preview size is NOT licensed for
the site: the "horn band" image was removed for that reason.

On 8 Nov 2026 all six photos below (previously received from the owner without provenance)
were replaced with free stock photos from Unsplash (owner decision). Each was downloaded from
Unsplash's own image CDN (`images.unsplash.com/<image id>`), cropped and resized with sharp to
the old file's exact dimensions (so no code or layout changed), and saved without EXIF/GPS/XMP
metadata. The `sha256` is of the committed file.

**Licence:** Unsplash License, <https://unsplash.com/license> (checked 8 Nov 2026): free to use,
including for commercial purposes, "without permission from or attributing the photographer or
Unsplash"; attribution is appreciated, not required. Limits that matter to us: photos can't be
sold unaltered, or used to build a competing photo service. The licence covers the photograph
only: it gives no model release (people's likeness) and no trademark/artwork clearance, which is
why these were picked without identifiable faces or legible logos.

| File | Used on the site | Source page | Image id | Photographer | People (identifiable?) | Logos / artworks visible | sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dj-crate-digging.jpg` (1920×1281) | Home "What else?" panel, "Only the good stuff" (`HOME_WHAT_ELSE`); sample live-music events (`LIVE_MUSIC_PHOTOS`) | [Hands sifting through vinyl records in a store](https://unsplash.com/photos/hands-sifting-through-vinyl-records-in-a-store-ogeQkALj3Hg) | `photo-1761098281103-51bf33e39d7f` | Dmytro Yarish, <https://unsplash.com/@dmytro_yarish> | One hand and sleeve only; no face (n) | None. Cropped to the lower half of the photo so the crate's band-name divider cards are out of frame | `05ac85823c196857463b716427065a408416fba6a7f6fac03033900a4d5ae52d` |
| `gallery-opening.jpg` (724×522) | Home hero lead tile (`HOME_HERO`, HeroCollage/HeroThumb); "See who's going" (`HOME_WHAT_ELSE`); sample art events, `southbank-sketch-salon` | [People standing in front of paintings](https://unsplash.com/photos/people-standnig-in-front-of-paintings-kOvOmb9946Y) | `photo-1579281377071-7a589cc8c3e8` | Frank R, <https://unsplash.com/@frank041985> | Five visitors, small and far away (n) | Framed photographs on the walls, too small to make out; no logos | `c9a2656754ba714c9a9c56f44aeb739d533907227b8159444d10103238d3f79e` |
| `street-market.jpg` (1440×1440) | Home "After dark" guide card (`HOME_GUIDE`) and For organisers card (`HOME_CREATORS`); sample pop-up events, `brunswick-zine-fair` | [A crowd of people standing around a market](https://unsplash.com/photos/a-crowd-of-people-standing-around-a-market-NRJxDAf70cc) (Queen Victoria Summer Night Market, Melbourne) | `photo-1569846567041-789685cd9e90` | Mitchell Luo, <https://unsplash.com/@mitchel3uo> | None in the crop: the square is taken from the top of the 6000×4000 original (festoon lights, market roof, CBD towers), so the crowd and a stall's branded tent are out of frame | None | `9c698d1e80e6d56431ba4a75a440bd14abe1dc122c40de0b48b1412a5f2104ff` |
| `vintage-market-stall.jpg` (760×507) | Home "What else?" panel, "Every organiser checked by a person" (`HOME_WHAT_ELSE`); sample pop-up events, `laneway-projections-after-dark` | [A rack of clothes and shoes in a store](https://unsplash.com/photos/a-rack-of-clothes-and-shoes-in-a-store-JGtPrdnMgQc) | `photo-1637228393246-c38a4b3d2011` | Hugo Clément, <https://unsplash.com/@hugo_cmt> | None in the crop (the two shoppers at the photo's edges were cropped out) | None legible (clothes and shoes, no visible labels) | `0fd92f58662ff42d2cf273173d0a812827f61adfbb9d03a8c02ea819ca0203e3` |
| `record-shop-dj.jpg` (1080×720) | Sample live-music events, `neon-static` (demo only); the decorative backdrop of the event page's "Who's going?" card (`CARD_PHOTO` in `components/whos-going/WhosGoingCard.tsx`, dimmed under a gradient) | [DJ at work (silhouette at a red-lit DJ controller)](https://unsplash.com/photos/selective-focus-silhouette-photography-of-man-playing-red-lighted-dj-terminal-YrtFlrLo2DQ) | `photo-1470225620780-dba8ba36b745` | Marcela Laskoski, <https://unsplash.com/@marcelalaskoski> | A silhouetted hand only (n) | None legible | `f6a5ac42e335f5a4e6ff46e3939874a56caaa99705ca311a34a515b775e0adb7` |
| `jazz-drummer.webp` (768×512) | Sample live-music events, `fitzroy-poetry-and-noise` (demo only) | [Person playing trumpet during night time](https://unsplash.com/photos/person-playing-trumpet-during-night-time-A10y2Eq7OHY) | `photo-1511192336575-5a79af67a629` | Chris Bair, <https://unsplash.com/@chrisbair> | A hand and sleeve only; no face (n) | None legible. Subject changed from a drummer to a trumpet (warmer, reads as live jazz); the file name is kept so no code changes | `938be2bba5ce0ac8775a42466d38086629ad362bf2f825aff1fa7da4ee6d5e16` |

All six: licence Unsplash License (<https://unsplash.com/license>), each photo page reads "Free to
use under the Unsplash License" (not Unsplash+); downloaded 8 Nov 2026; attribution not required.
If we ever credit them, use "Photo by <photographer> on Unsplash".
