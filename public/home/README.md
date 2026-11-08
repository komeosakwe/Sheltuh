Photos for the home page's static slots (`components/home/home-content.ts`):
the hero, the city guide card and the creators card. Drop a file here (e.g. `hero.jpg`),
ideally a square of at least 1200px so it survives every crop (images crop from the centre),
then set the matching `imageUrl` (e.g. `HOME_HERO.imageUrl = "/home/hero.jpg"`). Until then
each slot shows its generated poster art, at the same fixed size.
Find your people's "A look inside" card shows the five portraits in `people/` as overlapping
circles, in demo and live alike, always footnoted "Illustrative photos" (they are never anyone
going to an event). Their paths are listed in `COMMUNITY_SAMPLE_FACES`.

Replaced on 8 Nov 2026 (owner decision) with free stock photos from Unsplash, chosen so no face is
shown: each is a person from behind or in silhouette. Downloaded from `images.unsplash.com/<image id>`,
cropped square and resized with sharp to 320×320 WebP, saved without EXIF/GPS/XMP metadata.
Licence: Unsplash License, <https://unsplash.com/license> (free for commercial use, attribution
appreciated but not required; no model release, so no identifiable faces were used). Each source page
reads "Free to use under the Unsplash License" (not Unsplash+). Downloaded 8 Nov 2026. Used only in
the home "Find your people" / "A look inside" card (`COMMUNITY_SAMPLE_FACES`).

| File | Source page | Image id | Photographer | People (identifiable?) | Logos / artworks | sha256 |
| --- | --- | --- | --- | --- | --- | --- |
| `people/person-1.webp` | [Back of man's head wearing a yellow sweater](https://unsplash.com/photos/back-of-mans-head-wearing-a-yellow-sweater-1FvgDPKNOUw) | `photo-1772442088712-df1780cbb709` | GN Group, <https://unsplash.com/@gnhearingglobal> | Back of the head (n) | None (the source is a hearing-aid maker's photo; no product logo is visible in the crop) | `a0f5e125de64f0f4b78c435796c350e95c1702ce9339bb72f808edeec4e3dc3a` |
| `people/person-2.webp` | [A woman looking out over a city](https://unsplash.com/photos/a-woman-looking-out-over-a-city-pgbABg7UcOs) | `photo-1655658528558-7f536e01def9` | Vlad ION, <https://unsplash.com/@vlad_ion> | From behind, a sliver of cheek and glasses (n) | None | `7ee2e16198ee7abc48a2656091204a24873ff4ce3ca146f0ce0649fa844ab7f5` |
| `people/person-3.webp` | [Person wearing gray hoodie in parking garage](https://unsplash.com/photos/person-wearing-gray-hoodie-in-parking-garage-wSYIEM9qDDo) | `photo-1544393726-77046f17f6e1` | Christian Wiediger, <https://unsplash.com/@christianw> | From behind, hood up (n) | None | `7852162370526365422963c515b8d87371245682597d8411ad750bd58c304833` |
| `people/person-4.webp` | [Silhouette of crowd of people facing the performer at the stage](https://unsplash.com/photos/silhouette-of-crowd-of-people-facing-the-performer-at-the-stage-ngronCIThE4) | `photo-1533544514075-0269c5f5a4be` | Adi Rahman, <https://unsplash.com/@ceritadikit> | Silhouetted heads from behind (n) | None in the crop (the stage screen is cropped out) | `5262268826b35765f5f506e3979aacbe7edd3f717f369fabe7901f1c661993b3` |
| `people/person-5.webp` | [Silhouette photo of people watching concert](https://unsplash.com/photos/silhouette-photo-of-people-watching-concert-ya631mqQ7Ng) | `photo-1473691955023-da1c49c95c78` | A. L., <https://unsplash.com/@overdriv3> | Raised hands in silhouette (n) | None | `6bf6aef43398df0a592a9bc9b9da287367dc5f434f18fa6f1e3837ba756e7454` |

Only use images you have the rights to.

## Photos still needed (owner round, 23 Oct 2026)

The owner asked that the home's promo slots stop repeating the photos its event cards use. The six
photos in `public/events/` are all sample events' images, so only two are free for promo use, once
each: `gallery-opening.jpg` leads the desktop hero collage and `street-market.jpg` is the For
organisers card. Since 26 Oct 2026 the other slots temporarily reuse sample-event photos (owner: "reuse the event photos for now"); replace them as photos arrive (set
`imageUrl` in `components/home/home-content.ts`; nothing else changes):

| Slot | Count | Subject | Orientation, minimum size |
| --- | --- | --- | --- |
| What else? panel (`HOME_WHAT_ELSE`, desktop only) | 3 | One per promise: a person reviewing listings / curating; a ticket or door scene; a free community event | Portrait 4:5, 1000×1250 |

Ideally also a dedicated hero lead (landscape 5:4, 1600×1280) and an organiser photo (landscape 2:1,
1600×800), so no promo photo is shared with a sample event at all. Every one needs recorded rights
(the six in `public/events/` are Unsplash photos since 8 Nov 2026, see its README).
