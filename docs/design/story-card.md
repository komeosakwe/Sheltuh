# Story card ("I’m going."): render spec and share UI

Status: approved design (owner, 24 Nov 2026: the full-bleed card, with four changes) · Owner: ui-design-director ·
Scope: the 1080×1920 story card and the 1080×1080 post card made on the server, and the "Tell people you’re going"
section on the ticket pages, the share page and the ticket email.

**Who builds what.** §2–§8 are for the renderer (next/og `ImageResponse` = Satori + resvg, with every photo operation
done first in sharp). §9–§11 are for the frontend. §12 is the email line. The build plan (route, caching, tests) is
the manager's share-card plan. This file holds only the visual rules. It's enough to render the card without the
design round's scratch files.

**Code read** (origin/main `acf02d4`): `lib/soon.ts`, `lib/share-card.ts`, `lib/server/share-card-render.tsx`,
`lib/server/share-card-data.ts` (`coverToCardImage`), `lib/image.ts`, `lib/format.ts` (`zoneSuffix`),
`lib/ticket-times.ts`, `app/globals.css` (`.btn*`, type utilities, tokens), `components/tickets/MyTicketView.tsx`,
`components/tickets/ReceivedTicket.tsx` (PR #89), `lib/server/email-kit.ts` (`kitTellAFriend`),
`docs/design/brand-direction-one.md`, `docs/design/my-ticket.md`, `docs/design/ticket-email.md`.

---

## 0. References (`docs/design/story-card/`)

These are 540 px-wide copies of the design round's 1080 px renders. Measure at ×2. They use the cleared Unsplash
photos in `public/events/` (provenance: `public/events/README.md`).

| File | What it shows |
| --- | --- |
| `r4-01-market.jpg` | Story, full-bleed (street-market.jpg, 1440 px, focus 50/30), "In 3 days" |
| `r4-01-market-guides.jpg` | The same, with Instagram's safe zones in blue: the top 250 px and the bottom 340 px |
| `r4-01-crate.jpg` | Story, full-bleed, a dark teal photo (focus 85/50) |
| `r4-02-square-market.jpg`, `r4-02-square-crate.jpg` | Post, 1080×1080 |
| `r4-03-tonight-crate.jpg` | The "Tonight" tag |
| `r5-01-gallery.jpg` | Backdrop mode on a bright, low-resolution photo |
| `r5-02-vintage.jpg` | Backdrop mode on a busy photo |
| `r5-03-djdeck-long.jpg` | Backdrop mode with a three-line title ("The Long Night of Short Films") |
| `r5-04-trumpet-short.jpg` | Backdrop mode with a one-word title ("Zine") |
| `r5-05-gallery-long.jpg` | Bright photo, three-line title: the fade follows the title |
| `r5-06-market-short.jpg` | Full-bleed with a one-word title |

The references were drawn in Chrome. §8 lists what the server render does differently, on purpose.

## 1. Principles

1. **The photo is the card.** There's one display moment (the title). Everything else is small and quiet, and orange
   appears only as the two dots: never as a fill on a photo card.
2. **The text sits on the photo's own colour.** The fade at the bottom is sampled from the photo, so every card looks
   like its event rather than like a template. White on that tone is always ≥14:1 (§3.2).
3. **Bottom-anchored, inside the safe zones.** The text grows upwards from a fixed baseline, and the fade grows with
   it. Nothing that matters sits where Instagram draws its own UI.
4. **Public facts only.** A card never shows a price, a ticket, a QR code, a backup code, the ü barcode, an order id
   or link, a wallet link, the buyer's name or email, or anyone else's face or name (§7.4).
5. **Every value is computable without measuring text.** Satori can't measure before it lays out. Sizes come from
   character counts, and positions come from flex layout (§4.4).

## 2. Canvas and safe zones

| | Story | Post (square) |
| --- | --- | --- |
| Size | 1080×1920 | 1080×1080 |
| Side margins | 80 | 60 |
| Top row (tag, wordmark) | y 282 to 341 | y 60 to 119 |
| Text block ends at | **y 1600** (bottom padding 320) | y 1020 (bottom padding 60) |
| Instagram covers | y 0–250 (progress bar, profile row) and y 1580–1920 (reply bar) | nothing on the post itself |
| Must sit inside | Tag, wordmark, "I’m going.", title, facts: **y 250–1580**. The footer line may sit at y 1572–1600 (the owner's "ending above y 1600"). It's the quietest element, and the link sticker carries the link anyway | 60 px margins on all sides |

- **Below y 1600 (story):** there's only the solid tone. It's the band Instagram covers with its reply bar.
- **The post in the profile grid (unverified, open point):** Instagram's grid shows feed posts as a 3:4 crop, which
  trims about 135 px off each side of a square post. In the thumbnail, the tag and wordmark would be partly cut. The
  post itself is whole. §13 has a possible fix.

## 3. Colour

### 3.1 Fixed colours

The card is an image, so it uses literal values, not CSS variables. `app/globals.css` doesn't change.

| Role | Value | Notes |
| --- | --- | --- |
| Type on photo cards | `#ffffff` | |
| The two dots (photo cards) | `#ff4800` (`--signal`) | Non-text marks |
| Top shade | `rgba(0,0,0,0.5)` → `rgba(0,0,0,0)` | Lies under the tag and wordmark (the brand's ink-scrim rule for a wordmark on a photo) |
| Tag fill | `rgba(0,0,0,0.38)` | No blur (D1) |
| Tag border | 1.5 px `rgba(255,255,255,0.22)` | |
| Footer rule | 1 px `rgba(255,255,255,0.16)`, inside the footer's 0.85 opacity (resolved: white at 0.136) | |
| Tone when sampling fails (photo present) | `tone #151515`, `toneLight #cfcfcf` | |
| No-photo card | §6 | |

### 3.2 The sampled tone (owner-approved rule, round 3)

Run it on the server with sharp, in a pure function `toneFromMean(r, g, b)` (`lib/story-card.ts`):

1. Take the **cover crop**: the photo cropped to the card's aspect around its focus point, exactly as §5.2 crops it
   for full-bleed. Flatten any alpha onto black.
2. Resize that crop to **48×48** (`fit: "fill"`). Take rows **32–47** (`extract({ left: 0, top: 32, width: 48,
   height: 16 })`), the bottom third, which is where the text sits. Get the mean of each channel with `.stats()`, on
   the **sRGB (gamma-encoded) values**, as the reference does. Don't linearise.
3. Convert the mean (0–255) to HSL (standard sRGB→HSL; hue in degrees; for a grey, the hue is 0 and the saturation
   is 0).
4. Then:
   - `tone = hsl(h, min(s, 0.32), 0.13)`
   - `toneLight = hsl(h, min(s, 0.20), 0.78)`
5. Convert both back to integer RGB (round each channel), and emit them as `rgb(r, g, b)` / `rgba(r, g, b, a)`
   strings. Don't rely on Satori parsing `hsl()`.

**Checks** (unit-test these):
- A grey mean gives `rgb(33, 33, 33)` and `rgb(199, 199, 199)`.
- White on `tone` is ≥14:1 for every hue: the worst case is yellow, at about 14.2:1, and grey is 16.1:1.
- `toneLight` on `tone` is about 9:1 at every hue (grey 9.5, blue 9.1, yellow 9.3).

**Backdrop mode samples the same cover crop.** Its bottom third is the backdrop's bottom third: what's behind the
text there.

### 3.3 Text contrast over the fade

The fade's stops are fixed in px from the top of the text block (§4.3), so contrast doesn't depend on the title's
length. Worst case: a pure white photo behind the text, with the grey tone:

| Text | Fade opacity behind it | Contrast |
| --- | --- | --- |
| "I’m going." (46 px 600, large text) | 0.55–0.65 | ≥3.7:1 (AA large) |
| Title (≥80 px 700) | ≥0.72 | ≥6.4:1 |
| Facts, `toneLight` (33 px) | ≥0.80 | ≥5.0:1; the white date ≥8.4:1 |
| Footer | 1.0 (solid tone) | "Discover on" 7.3:1 |

## 4. Layout (photo cards)

### 4.1 Values

| Element | Story 1080×1920 | Square 1080×1080 |
| --- | --- | --- |
| **Tag** (pill) | left 80, top 282 | left 60, top 60 |
| Tag style | Instrument Sans 600 28/32 px, white, sentence case. Padding 12 px / 20 px, radius 12, fill and border per §3.1. Total height 59. Width hugs the text. Two dots 12×12, radius 3, gap 7, then 12 to the text, all centred vertically | same |
| **Wordmark** | Official vector (`WORDMARK`, ratio 4.41), white, **150×34**, right 80, top 296 | **140×32**, right 60, top 74 |
| | Its vertical centre lines up with the tag's (y 311.5 / 89.5). Keep that if either changes | |
| **Text block** | left 80, right 80 (920 wide), bottom edge at y 1600 | left 60, right 60 (960 wide), bottom edge at y 1020 |
| **"I’m going."** | Instrument Sans **600 46/53**, tracking −0.01em, white. Two dots **15×15**, radius 3, gap 7, `#ff4800`, then **16** to the text, centred vertically | **600 40/46**, dots **13×13**, gap 7, then 16 |
| **Title** | margin-top **14**. Instrument Sans **700**, size per §4.2 (128 default), line height **0.92 × size**, tracking **−0.04em**, `uppercase`, white, `wordBreak: break-word`. At most **4 lines**, ellipsis | margin-top **10**, 104 default, at most **3 lines** |
| **Facts** (2 lines) | margin-top **26**, 400 **33/48**. Line 1: the date in **600 white**, then " · " and the time in 400 `toneLight`. Line 2: the place in 400 `toneLight`, one line, ellipsis | margin-top **18**, **30/44** |
| **Footer** | margin-top **30**, a 1 px rule (§3.1), padding-top **22**. A row with gap **16**: "Discover on" 500 **23/28** `toneLight`, then "sheltuh.com.au" 600 23/28 white at opacity 0.9. The whole footer at **opacity 0.85** | margin-top **18**, padding-top **16**, **21/26** |
| **Top shade** | top 0, full width, **560** tall, `linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 100%)` | **260** tall |
| **Fade** | §4.3 | §4.3 |

**Copy, verbatim:**
- "I’m going." uses U+2019 and a full stop.
- "Discover on" and "sheltuh.com.au" are lower case. There's no `https://`, no path and no dotted vowels (the brand
  rule: dots belong to the wordmark and the heroes).

**Default block heights** (one-line title):
- Story: 53 + 14 + 118 + 26 + 96 + 30 + 1 + 22 + 28 = **388**, so the block's top is at y **1212** and the facts end
  at y 1520.
- Square: 46 + 10 + 96 + 18 + 88 + 18 + 1 + 16 + 26 ≈ **319**, so the block's top is at y **701**.

### 4.2 Title size and long titles

The text is `cardText(title, 80)` (whitespace collapsed, cut at a word with an ellipsis), after removing emoji (§7.2).
Count graphemes in that text, before uppercasing:

| Characters | Story size | Square size | ≈ characters per line, story / square |
| --- | --- | --- | --- |
| ≤ 30 | **128** | **104** | 12 / 15 |
| 31–45 | **112** | **92** | 14 / 18 |
| 46–60 | **96** | **80** | 16 / 20 |
| 61–80 | **80** | **68** | 19 / 24 |

- **Characters per line** is an estimate: about 0.59 em per uppercase character with the tracking, measured on
  "HERE & NOW" (760 px at 128).
- **The line clamp is the safety net.** Story clamps at 4 lines; square at 3.
- **The highest the block can rise:**
  - Story: 4 × 128 × 0.92 = 471, so the block's top is at y **859**. That's well below the tag (which ends at y 341),
    and the fade's top lands at y 559.
  - Square: 3 lines at 104, so the block's top is at y **510**, and the fade's top at y 210, under the tag row (which
    ends at y 119).
- **Accented capitals** (É, Ü, Å) rise above the cap height, and with a 0.92 line height and `overflow: hidden` (the
  clamp needs it), the first line's accents may be clipped. Spike S4: if they are, give the title
  `paddingTop: 0.12em` and `marginTop: (14 or 10) − 0.12em`, so the box grows upwards without moving the type.
- **A single word longer than a line** breaks (`wordBreak: break-word`) rather than running off the card.

### 4.3 The fade (owner-approved: "the fade follows the title")

- **Where:** it starts **300 px above the top of the text block** and runs to the bottom of the card, behind the
  text.
- **Stops, in px from the fade's top edge** (so its shape stays the same whatever the title's length):

| | Story | Square |
| --- | --- | --- |
| `rgba(tone, 0)` | 0 | 0 |
| `rgba(tone, 0.72)` | **388** (88 below the block's top) | **258** (42 above the block's top) |
| `rgb(tone)` | **797** (497 below the block's top) | **529** (229 below the block's top) |
| Solid tone from there down | yes | yes |

- **Where the numbers come from:** the reference's 0 / 38% / 78% stops at its default height (story 1022, square
  678). So a one-line title renders exactly like the reference. Longer titles get the same darkness behind
  "I’m going." instead of a lighter one: a deviation (D6), made for contrast (§3.3).
- **With the default story block,** the photo shows clearly down to about y 1200 and fades out by y 1695. Below
  that, there's only tone (the owner's "the photo runs down to about y 1700").
- **Spike S2:** check that Satori takes px stops. If it doesn't, convert them to % of the fade's estimated height
  (300 + estimated block height + bottom padding, with the block height from §4.1 and the title's estimated line
  count).

### 4.4 Satori structure (no measuring)

```
root  div 1080×H, position relative, display flex, background tone, fontFamily "Instrument Sans", color #fff
├─ 1 photo layer   absolute inset 0
│     full-bleed: <img> the cover crop, exactly W×H
│     backdrop:   <img> the pre-blurred backdrop (W/4×H/4 JPEG) drawn at W×H
├─ 2 layout        absolute inset 0, display flex, flexDirection column
│   ├─ A  upper zone   flexGrow 1, flexShrink 1, minHeight 0, marginBottom −80, display flex, flexDirection column
│   │     backdrop only: <img> the sharp photo, width 1080, height round(1080·h/w), flexShrink 0,
│   │                    marginTop "auto", maskImage per §5.3
│   └─ B  lower zone   position relative, display flex, flexDirection column,
│         paddingLeft/Right 80|60, paddingBottom 320|60
│       ├─ fade        absolute, top −300, left 0, right 0, bottom 0, backgroundImage per §4.3
│       └─ text block  display flex, flexDirection column (§4.1, top to bottom)
├─ 3 top shade     absolute, top 0, left 0, right 0, height 560|260
├─ 4 tag           absolute
└─ 5 wordmark      absolute
```

- **B's top is the block's top,** because B has no top padding. A's negative bottom margin puts A's bottom edge
  **80 px below the block's top**.
- **The sharp photo in A has `marginTop: auto`:**
  - When it's shorter than A, it sits at A's bottom, so its bottom edge is 80 px below the block's top (the
    reference's rule).
  - When it's taller, the auto margin collapses to 0, and it starts at y 0 and runs on under the text. That's the
    reference's `max(0, …)` clamp.
  - Spike S1 checks that Yoga treats a negative free space this way. Fallback: estimate the block's top from §4.1
    and §4.2 and set `top` directly.
- **Paint order is tree order:** photo, sharp photo, fade, text, shade, tag, wordmark. The shade only overlaps the
  fade on square cards with a three-line title; both darken, so the order there doesn't show.

## 5. Imagery

### 5.1 Which mode

- Take the source's width and height **after EXIF rotation** (orientations 5–8 swap them), as `coverToCardImage`
  does.
- `upscale = max(W / w, H / h)`, where W×H is the card.
- **Backdrop mode when `upscale > 1.6`** (strictly greater). Otherwise **full-bleed**.

**What that means in practice.** Event images are capped at **1600 px on the long edge** (`lib/image.ts`):
- **Story:** any **landscape cover wider than 4:3** gets backdrop mode (1600×1067 gives 1.8; 1600×900 gives 2.13). A
  4:3 cover at full size (1600×1200) gives exactly 1.6, so it's full-bleed. Portrait and square covers are full-bleed.
- **Square:** backdrop mode only when the short side is under 675 px.
- **The demo photos** (507–720 px tall) all get backdrop mode on the story.

So backdrop mode is the **common** case for stories, not the exception. It's designed for that (the r5 references),
but see §13 Q1.

### 5.2 Full-bleed

- **The crop:** exactly `coverToCardImage`'s focus maths, at W×H:
  - `scale = max(W/w, H/h)`
  - resize to `(max(W, round(w·scale)), max(H, round(h·scale)))`
  - `left = round(fx·(sw − W))`, `top = round(fy·(sh − H))`, with `fx` and `fy` the focus point / 100 (default 0.5)
- These are the site's `object-position` semantics, and the same crop is used for the tone (§3.2).
- Encode it as a JPEG data URL (quality 82, as the link preview).

### 5.3 Backdrop mode

1. **Backdrop:** the cover crop (§5.2) at **¼ size** (270×480 story, 270×270 square). Then `.blur(10)` (sigma 10 at
   ¼ size ≈ CSS `blur(40px)` at full size), then `.linear(0.7, 0)` (≈ `brightness(.7)`), then a JPEG. Satori draws
   it at full card size. There's no `scale(1.2)`: sharp's blur doesn't fade the edges the way CSS does.
2. **Sharp photo:** the **whole** photo, uncropped (the focus point doesn't apply), at 1080 wide and
   `round(1080·h/w)` tall. Its mask is `linear-gradient(180deg, transparent 0%, #000 14%, #000 78%, transparent
   100%)`. Its position follows §4.4. If `maskImage` doesn't render (spike S3), bake the alpha in with sharp: multiply
   a PNG's alpha by the same ramp. Never just leave the mask off, because that leaves a hard photo edge.

### 5.4 Text on the image

All text sits on the top shade (tag, wordmark) or on the fade (the block). Nothing is ever set straight onto an
unshaded photo.

## 6. No photo

This is used when the event has no cover, or the cover can't be decoded or read. It follows the link preview's
no-photo card (Signal Orange, ink type), at the same positions as §4.1.

| Element | Treatment |
| --- | --- |
| Background | `#ff4800`, flat. No photo, no fade, no top shade |
| Tag | **Ink pill**: `#000000` fill, no border, white 600 28/32 text (21:1), orange dots (6.18:1 on black). Same size and position |
| Wordmark | `#000000` (the brand's "black on orange") |
| "I’m going." and its dots | Black text; **black** dots (orange on orange would vanish) |
| Title | Black, 700, the same sizes and clamp |
| Facts | Date 600 black; time and place 400 black. **No grey and no opacity on orange** (the brand rule; black on orange is 6.18:1) |
| Footer | Rule 1 px `rgba(0,0,0,0.24)`; "Discover on" 500 black; "sheltuh.com.au" 600 black. No opacity |

- **The layout is identical** to the photo card, so the text block still ends at y 1600 (or 1020).
- **If the photo decodes but its stats fail:** this isn't the no-photo card. Draw the photo with the fallback tone
  (§3.1).
- **Not chosen:** the site's generated poster art (`EventArt`). It would need porting to Satori, and the orange card
  already matches the link preview. §13 Q3.

## 7. Content rules

### 7.1 The tag

`storyCardTag(event, now)`, in the event's own time zone, by calendar date (it's safe across daylight-saving
changes):

| When | Tag |
| --- | --- |
| Started and not ended | "On now" |
| Starts later today, 5:00 pm or later | "Tonight" |
| Starts later today, before 5:00 pm | "Today" |
| Starts tomorrow | "Tomorrow" |
| Starts N ≥ 2 calendar days ahead | "In N days" (e.g. "In 3 days", "In 41 days") |
| Ended | no card (404) |

- **The first four rows are `soonLabel` in `lib/soon.ts`.**
- **The owner's wording was "Tonight" for any same day,** and the site's soon tag says "Today" before 5 pm and "On
  now" once the event has started. The card uses the site's wording, so the card and the event page never disagree
  (D3).
- **N is unbounded.** "In 120 days" fits the pill.
- **The tag is fixed when the image is made.** The route's cache window ends at the next tag change (the plan, §3.6).

### 7.2 Text

- **Title:** `cardText(title, 80)`. First, remove pictographic emoji (`\p{Extended_Pictographic}`, ZWJ U+200D and
  VS16 U+FE0F) and collapse the spaces left behind. If that leaves nothing, keep the original title. Satori's
  `textTransform: uppercase` does the capitals; don't uppercase in JS (screen readers never see this text anyway).
- **Facts line 1:** `ticketStubDate(start, zone)` · `ticketStubTime(start, end, zone)` +
  `zoneSuffix(zone, state, start)`.
  - Examples: "Sat 14 Nov · 5–9 pm" and "Sat 21 Nov · 8 pm Perth time".
  - **Pass the start as `instant`** (decision): Sydney, Canberra and Hobart cards then never say "Sydney time", as on
    the event pages. The plan's draft used the link preview's form without `instant`.
  - The line can't overflow by construction (the longest is about 45 characters ≈ 770 px at 33 px), so it has no
    clamp.
- **Facts line 2:** `[venueName, bareSuburb(suburb, state)]`, empty parts dropped, joined with ", ". One line,
  ellipsis at 920 / 960 px. If both parts are empty, leave the line out: the block gets shorter and the fade follows
  it.
- **No price, ever** (so no stale or non-all-inclusive price can appear). The same goes for free events.

### 7.3 Fonts

- **Instrument Sans, static TTFs:** Regular 400, Medium 500, SemiBold 600 and Bold 700, full Latin + Latin Extended,
  in `app/fonts/og/` (OFL, the licence already there).
- No other face. Bootzy and Plex Mono aren't used on the card.

### 7.4 Never on a card

- Ticket QR, backup or entry code, the ü barcode
- Order id or order link, wallet link
- The buyer's name or email
- Other attendees' faces, names or counts
- Any price

The only URL text is "sheltuh.com.au". The shared link is the plain event URL, added by the person as an Instagram
Link sticker.

## 8. Declared deviations from the references (for visual QA)

| # | Reference | Render | Why |
| --- | --- | --- | --- |
| D1 | Frosted tag (`backdrop-filter: blur(12px)`) | No blur, same fill and border | Satori has no `backdrop-filter`. If QA finds the tag hard to read on a busy photo (check `r5-02` vintage), raise the fill to `rgba(0,0,0,0.45)` and record it here |
| D2 | Tone from the whole photo squashed to 48×48 | Tone from the card's crop (§3.2) | That's the approved rule (it samples what's behind the text). Tones may differ slightly |
| D3 | "Tonight" for any same-day start | "Today" before 5 pm, "On now" once started | The site's `soonLabel` (owner request, 13 Nov) |
| D4 | "5–9pm" | "5–9 pm" | The site's `ticketStubTime` |
| D5 | "I'm going." (straight apostrophe) | "I’m going." (U+2019) | The site's typography |
| D6 | Fade stops in % of the fade's height | Stops in px from the block's top (§4.3) | Identical for one-line titles. Darker behind "I’m going." for long ones (contrast) |
| D7 | CSS `blur(40px) brightness(.7) scale(1.2)` | sharp pre-blur at ¼ size, sigma 10, ×0.7 | Satori's `filter` is unreliable and costly. It looks the same |
| D8 | — | Long-title steps (§4.2), the no-photo card (§6), emoji stripping | Not drawn in the round |
| D9 | Chrome text rendering | resvg text rendering | It differs by design. Compare positions ±2 px and sizes ±1 px, not pixels |

## 9. Share UI: `components/StoryCardShare.tsx`

### 9.1 Anatomy: compact variant (My ticket, received ticket)

It's a right-column card in the same style as "Add to calendar" (`cardClass` in `MyTicketView.tsx`):

```
section[aria-labelledby=story-card-title]  flex flex-col gap-4 rounded-control border border-surface-border bg-card p-6 print:hidden
  h2#story-card-title   text-xl/7 font-semibold                        "Tell people you’re going"
  div  flex gap-4 items-start
    preview  w-24 (96) lg:w-40 (160) shrink-0 rounded-control bg-surface overflow-hidden
             aspect-[9/16] (Story) | aspect-square (Post); <img> object-cover, the prepared Blob's object URL
    div  flex min-w-0 flex-col gap-4
      p  body-s text-muted   "Post a card with the event’s photo. Your ticket and QR code are never on it."
      [lg+] toggle, actions, hint, status (as below)
  [below lg] toggle, actions, hint, status, each full width
```

- **The toggle** is a `fieldset` with `legend.sr-only` "Card shape", holding two native radios styled as chips:
  - Labels "Story" and "Post", default Story, in `flex flex-wrap gap-2`.
  - Each chip is a `label` of `min-h-11 min-w-11 px-4 rounded-control border-[1.5px] border-foreground`, with the
    `body-s font-semibold` label. The radio input is visually hidden but focusable.
  - **Checked:** `bg-foreground text-background` (an inversion, not a hue).
  - **Hover:** `bg-surface` when unchecked.
  - **Focus-visible:** the global ring, on the chip (`:has(:focus-visible)`).
  - No dots: §5 of the brand book keeps them for filter chips.
- **Actions:** `flex flex-col gap-3 lg:flex-row lg:flex-wrap`. Buttons are `w-full lg:w-auto`, at size M (48):
  1. **Primary, `btn btn-solid`** (black; inverted in Dark), never `btn-signal`. The ticket pages' one orange action
     is "Show ticket", so a second orange button would compete with it.
     - Phones that can share files: "Share to story" (Story) or "Share post" (Post).
     - Everything else: "Save image" (`<a download="sheltuh-{slug}-{story|square}.jpg">` on the object URL).
  2. **"Copy event link", `btn btn-outline`.** It copies `publicEventUrl(slug, origin)`: the plain URL, no query
     string.
  3. **After a share-sheet error only:** "Save image", `btn btn-outline`, between 1 and 2.
- **Hint:** `p.body-s text-muted` "In Instagram, add a Link sticker and paste the event link." It's always shown
  while the card is available.
- **In-app browsers** (`lib/in-app-browser.ts`): under the hint, `p.body-s` "Sharing works best in your browser."
  plus the link "Open in {browser}" (`openInBrowserHref`, underlined, `min-h-11 inline-flex`).
- **Status:** one `p[role=status] body-s text-foreground`, always in the DOM (empty when idle), under the hint.

**Placement:**
- **My ticket:** the **first card in the right column**, directly under the heading block (order line, h1, facts),
  above "Add to calendar".
  - On phones, the column stack already puts "Show ticket" and the wallet badges above it, so the door actions keep
    their place.
  - It shows when the event is listed, `eventSlug` and the times are present, and the event hasn't ended.
- **Received ticket (#89):** the same place, under the heading block and above `TicketCalendarCard`, when the ticket
  is held and the event is listed and hasn't ended.
- **Never in** the full-screen ticket, and never printed.

**Widths:**

| Width | Right column (approx.) | Preview | Layout |
| --- | --- | --- | --- |
| 320 | 288 card, 240 inner | 96×171 | Preview + sub side by side; toggle, buttons and hint full width under them |
| 390 | 358 card, 310 inner | 96×171 | Same |
| 768 | about 384 card, 336 inner | 96×171 | Same |
| 1024 | about 552 card, 504 inner | 160×284 | Preview left; everything else in the column beside it |
| 1440 | about 904 card, 856 inner | 160×284 | Same. Buttons sit side by side at their own width |

With Post selected, the preview is square (96×96, or 160×160 from lg) and the column doesn't move.

### 9.2 Anatomy: large variant (the share page, `/events/[slug]/share`)

- **Page:** `pt-8 md:pt-12 pb-16`, in the site container.
- **Below lg:** one column, `max-w-120` (480), left-aligned, `flex flex-col gap-6`:
  1. h1 `heading-h1` "Share that you’re going" (32/40 on phones, 40/48 from md).
  2. The event, `flex flex-col gap-1`: the title `body-l font-semibold`, then the date line `body-s text-muted`
     (`ticketWhenLine`).
  3. The preview: Story `w-54` (216×384), `md:w-68` (272×484); Post `w-72` (288×288), `md:w-90` (360×360).
     `rounded-card`, `bg-surface`.
  4. Then the toggle, the actions, the hint and the status, as in §9.1.
  5. "View event page →" (`quietLinkClass`, the event's path).
- **From lg:** a grid `lg:grid-cols-[22.5rem_minmax(0,28rem)] lg:gap-16 lg:items-start`:
  - Column 1: the preview at **360** wide (360×640, or 360×360 for Post).
  - Column 2: items 1, 2 and 4–5, in that order.
- **No section card** on this page. The page is the component.
- **Metadata:** the title "Share that you’re going: {title}", and `robots: noindex`.

### 9.3 States (both variants)

| State | Preview | Primary | Copy link | Status text |
| --- | --- | --- | --- | --- |
| Not yet visible | `bg-surface` box at the format's ratio | `aria-disabled` (the `.btn[aria-disabled]` grey) | enabled | — |
| Preparing (the fetch starts when the section nears the viewport) | the same box | `aria-disabled` | enabled | "Preparing your card…" |
| Ready | the image; `alt` = "Your {story/post} card: I’m going. {title}, {date line}, {place line}" | enabled | enabled | — (cleared) |
| Shared (the share resolved) | — | — | — | "Card shared." |
| Cancelled (`AbortError`) | — | — | — | nothing, no analytics |
| Share sheet failed | — | — | — | "Couldn’t open the share sheet. Save the image instead." Show the outline "Save image" |
| Saved (the download link was clicked) | — | — | — | "Your card is downloading." |
| Link copied | — | — | — | "Event link copied." |
| Copy refused | — | — | The link appears in a selected read-only field under the buttons (the `ShareButton` pattern) | "Copy the link from the box." |
| Format switched | the new format's box, then its image; both Blobs are kept once fetched | as above | enabled | "Preparing your card…" until it's ready |
| 404 (ended or unlisted) | replaced by `p.body-m` "This event has ended or isn’t listed any more." | hidden | hidden | — |
| 429, 503, 5xx or timeout | `bg-surface` box | replaced by "Try again" (`btn btn-outline`) | enabled | "Couldn’t make your card. Try again." |

- **Hover, focus-visible, active and disabled** come from the existing `.btn` classes. Nothing new.
- **Focus stays on the pressed control** in every state. When "Try again" replaces the primary, move focus to it.
- **Dark theme:** the tokens invert, and the preview image doesn't change.
- **Targets:** every control is ≥44 px tall (the buttons are 48, the chips 44).

## 10. Motion

- **The card is a still image.** No animation, no countdown ticking.
- **The UI adds no motion of its own.** Buttons keep their existing 200 ms colour transitions, and no loader
  animates: the preparing state is a static box plus text. `prefers-reduced-motion` needs nothing extra.

## 11. Brand book addition (`brand-direction-one.md` §5, the dots list)

Add this row (it's outside PR 0's files: the manager applies it or approves the edit):

| # | Use | Spec | Motion | Reduced motion |
| --- | --- | --- | --- | --- |
| 10 | **Story card** (`story-card.md`) | Two `#ff4800` squares, radius 3, gap 7, before "I’m going." (15 px story, 13 px square), and two 12 px squares in the countdown tag. Black on the no-photo orange card | None (an image) | — |

## 12. Ticket email ("Going with friends?", PR 5)

- **New first chip:** "Instagram story", linking to `{site}/events/{slug}/share`. Only for a listed event, like the
  other chips. It uses the same chip style as the others (`kitTellAFriend`).
- **The box's line becomes:** "Send them the event, or post your story card." (was "Send them the event so you can
  go together.").
- **Plain-text part:** "Share that you’re going (story card): {url}".
- **No image in the email.**

## 13. Dependencies, open points, out of scope

**Renderer spike (PR 1), each with its fallback:**
- **S1:** the `marginTop: auto` clamp in §4.4. Fallback: estimate the block's top and set `top`.
- **S2:** px stops in `linear-gradient`. Fallback: % of the estimated fade height.
- **S3:** `maskImage` on `<img>`. Fallback: bake the alpha into a PNG with sharp.
- **S4:** accent clipping on the first title line with `lineClamp`; test "ÉTÉ À MÜNCHEN". Fallback: the 0.12em
  padding.
- **S5:** mixed weights in facts line 1. Fallback: two text elements in a row.
- **S6:** `wordBreak: break-word`. Test a 40-character single word.
- **S7:** tag height 59 ±2 with the explicit 32 px line height.
- **S8:** render time p50/p95 and JPEG size on the reference set, plus no-photo, an 80-character title, an emoji
  title and a Perth event.

**Open points (for the manager or owner):**
- **Q1, landscape covers:** with the 1600 px upload cap, most landscape covers render in backdrop mode on stories
  (§5.1).
  - The owner chose full-bleed after seeing both, so this is a heads-up, not a blocker.
  - Raising `MAX_EDGE_PX` (for example to 2400) would let 3:2 covers go full-bleed. That's a frontend/backend change
    with a storage cost, and it only affects new uploads. Not proposed for this build.
- **Q2, the post format:** the profile grid's 3:4 thumbnail may trim the square post's tag and wordmark (§2,
  unverified). Option: a 1080×1350 (4:5) post format later, with the same rules and bottom padding 60.
- **Q3, no-photo card:** Signal Orange (built) or a Satori port of the `EventArt` poster. Recommend orange.

**Dependencies:** the fonts (§7.3) and the four spike results. There's nothing new in the image pipeline: the cover's
bytes and focus already exist (`findPublicEventCover`).

**Out of scope:**
- Who's Going, countdown-only and Wrapped styles; organiser branding on cards.
- UTM tags or referral credit (owner question 47).
- A short `/e/` link.
- An image in emails.
- Changes to `app/globals.css`.
