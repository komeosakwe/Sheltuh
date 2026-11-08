Drop event photos here as `<slug>.jpg` (e.g. `neon-static.jpg`), ideally square, ~1200px,
then reference it from `lib/sample-photos.ts` (`PHOTO_BY_SLUG` or `LIVE_MUSIC_PHOTOS`).
Sample events without a listed photo show the generated poster art. Only use images you have the rights to.

## Photo sources

Record where every photo came from and its licence here before deploying. A photo whose
metadata shows a stock-library credit (Getty/iStock) at preview size is NOT licensed for
the site: the "horn band" image was removed for that reason. Photos received from the
owner without provenance: gallery-opening, vintage-market-stall, street-market,
record-shop-dj, dj-crate-digging (credit "phrank.net" visible), jazz-drummer. Confirm rights
for each, or replace with licensed photos (Unsplash/Pexels/own shots).

`dj-crate-digging.jpg` is also the decorative crowd behind the event page's "Who's going?" card
(`components/whos-going/WhosGoingCard.tsx`, owner's mockup of 8 Nov 2026), dimmed under a gradient.
Its rights need confirming before launch like the rest; swap `CARD_PHOTO` for a licensed crowd photo.
