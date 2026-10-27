Photos for the home page's static slots (`components/home/home-content.ts`):
the hero, the city guide card and the creators card. Drop a file here (e.g. `hero.jpg`),
ideally a square of at least 1200px so it survives every crop (images crop from the centre),
then set the matching `imageUrl` (e.g. `HOME_HERO.imageUrl = "/home/hero.jpg"`). Until then
each slot shows its generated poster art, at the same fixed size.
Find your people's "A look inside" card shows the five portraits in `people/` as overlapping
circles, in demo and live alike, always footnoted "Illustrative photos" (they are never anyone
going to an event). Their paths are listed in `COMMUNITY_SAMPLE_FACES`.

- `people/person-1.webp` … `people/person-5.webp`: supplied by the owner on 23 Oct 2026 for the
  home band (illustrative portraits); cropped from the owner's strip to 320×320 WebP. Permission:
  owner-supplied — owner to confirm usage rights/model releases.

Only use images you have the rights to.

## Photos still needed (owner round, 23 Oct 2026)

The owner asked that the home's promo slots stop repeating the photos its event cards use. The six
photos in `public/events/` are all sample events' images, so only two are free for promo use, once
each: `gallery-opening.jpg` leads the desktop hero collage and `street-market.jpg` is the For
organisers card. Since 26 Oct 2026 the other five slots temporarily reuse sample-event photos (owner: "reuse the event photos for now"); replace them as photos arrive (set
`imageUrl` in `components/home/home-content.ts`; nothing else changes):

| Slot | Count | Subject | Orientation, minimum size |
| --- | --- | --- | --- |
| Hero collage tiles (`HOME_HERO_TILES`, desktop only) | 2 | Melbourne creative crowds or venues (not DJs or markets, which the sample events use) | Landscape 3:2, 1200×800 |
| What else? panel (`HOME_WHAT_ELSE`, desktop only) | 3 | One per promise: a person reviewing listings / curating; a ticket or door scene; a free community event | Portrait 4:5, 1000×1250 |

Ideally also a dedicated hero lead (landscape 5:4, 1600×1280) and an organiser photo (landscape 2:1,
1600×800), so no promo photo is shared with a sample event at all. Every one needs recorded rights
(the six in `public/events/` have none yet, see its README).
