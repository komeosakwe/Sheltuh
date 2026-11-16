# Round 2 handoff (Latte, 16 Nov 2026) and the owner's amendments

The handoff below is Latte's, as received. The owner's amendments come first
and win wherever they disagree with it.

## Owner's amendments (16 Nov 2026)

- Preserve event date/time on cards and Nearby results.
- Use readable proportional Instrument Sans metadata, not monospace.
- Preserve content order across breakpoints, allowing responsive reflow.
- Use explicit banner aspect ratios and breakpoint-specific image focal points.
- If autoplay remains, retain a visible pause/resume control, stop on keyboard
  focus, and respect reduced-motion preferences.
- Keep banner navigation and purchase controls semantically separate; do not
  nest interactive controls inside a full-banner link.
- Filter events by selected location before considering artist grouping.
- Remove duplicate ticket UI without removing ticket selection.
- Use only real, privacy-permitted attendance data.
- Support focus and touch equivalents for hover interactions.
- Preserve official artist/event names; do not bulk title-case the database.
- Keep Community's current availability until an explicit decision is given.
- Do not invent missing Figma specifications, filter definitions or content.

Implement the unambiguous global fixes first. Verify 1440, 1200, 1024, 768
and 390px, plus narrow-screen overflow. Provide screenshots and list
unresolved decisions separately. Do not merge or deploy.

Extra notes from the designer's messages (owner, 16 Nov 2026):

- Buy tickets button has a hover effect (black with an orange label).
- Homepage city list: when the pointer is over a different city, the image
  changes to that city's.
- The nav font size is a little large; make it smaller.

---

# Sheltüh website — Round 2 fixes

Prepared by Latte · 16 Nov 2026 · based on a check of sheltuh.com.au (desktop)
and phone screenshots on 16 Nov.

**Reference:** Figma page **"Round 2 samples"** (links not supplied to
engineering). Until the Rules page is updated, these samples win over the
Rules page and the first handoff list.

Work through **Part 1 first** (each item fixes every page), then Part 2.

## Part 1 — Global changes (main)

### 1.1 Featured banner

| What | Live now | Change to |
| --- | --- | --- |
| Height | Fixed `aspect-[7/2]` on desktop → 1154 × 330 at a 1440 window. Too short, the photo is a thin strip. | Desktop **5:2** (or fixed 480–520 px). Tablet 2:1 (as now). Mobile **4:5** (now 1:1). |
| Text background | Solid black box over the photo | **No box.** One black gradient over the whole photo: transparent from the top to 35 %, then down to **80 % black** at the bottom. Text sits straight on the photo. |
| Content | Category, title, date · time · place · price, Buy tickets, Details | Only **category · title · date · venue · Buy tickets**. Drop time, price and the Details button — the whole banner opens the event page. |
| Controls | Dots + pause / prev / next buttons | **Dots only**, bottom-right. Swipe on touch. Auto-advance stays. |
| Buy tickets | Orange | Orange + black label (Buy tickets component). L 56 on desktop, M 48 below 1440. |
| Padding | — | 48 desktop · 32 tablet · 24 mobile. Same layout on every size (no different mobile layout). |

### 1.2 Responsive design

The site uses the 1440 values at every width. Sizes must step down, but the
**layout stays the same** on every device.

|  | ≥ 1280 (1440 frame) | 1024–1279 | 768–1023 | < 768 (390 frame) |
| --- | --- | --- | --- | --- |
| Header height | 72 (64 after scroll) | 72 | 56 | 56 |
| Nav | Discover · Nearby · Community, 16 Medium | same | logo + search icon + menu | logo + search icon + menu |
| Hero | badge + headline + search **on one row** | one row, badge 72, Where/When narrower | badge + headline row, search full width below | same as 768 |
| Search | Search · Where · When + Search button | same, compact | one field → opens search sheet | one field → opens search sheet |
| Event cards | 4 per row | 3 per row | swipe row / 2 per row | swipe row / 1 per row |
| Category chips | one row | scroll | scroll | scroll |
| Page margin | 64 | 32 | 32 | 16 |

Also: at ~1200 px the search bar currently drops under the headline and
leaves a big empty area, and "Bring your event to / life" breaks onto two
lines. Both are fixed by the table above.

### 1.3 Type sizes (smaller)

| Text | Desktop | 1024 / 768 | Mobile |
| --- | --- | --- | --- |
| Nav | **16** Medium (now 18) | 16 | menu |
| Hero headline | **56** (now 72) | 48 | 40 |
| Section titles (This weekend, All events…) | **32** (now 40) | 32 | 24 |
| Banner title | 40 | 32 | 28 |
| Body | 16 | 16 | 16 (the hero subline is too big on phones now) |

### 1.4 Section spacing

**64** between sections on desktop (replaces 88), **48** tablet, **40** mobile.

### 1.5 Event card

| What | Change to |
| --- | --- |
| Price button | **Orange + black label** by default. On card hover: **black + orange label** (same as the Buy tickets hover). |
| Card hover | Cream fill, title underlined. |
| Cards on a cream background (Community) | White card + **1.5 px black outline**; hover = grey `#F2F1EE` + underlined title, like the Nearby list. Otherwise the hover can't be seen on cream. |
| Content | As in the first handoff list: one tag, title, location · venue in mono (no date/time), who's going avatars, image 2:1. |

### 1.6 Bootzy capital I

The display font draws a capital **I** as a hairline, so headlines read "FND
YOÜR", "KOF STONE", "COMMUNTY". Check the font file / version with the brand
designer. Until fixed, consider Instrument Sans Bold for headlines that
contain an I.

### 1.7 Letter case

Event titles, venues and addresses in normal case ("Northcote Theatre",
"West Melbourne, VIC"). All caps only for short labels (SAT, NOV, AEDT).
Event titles currently mix "OSAMA SON" with "Baby Keem" — fix in the data.

## Part 2 — Detail fixes

### Homepage

- **This weekend:** only 2 cards, both Kofi Stone (Melbourne + Sydney shows).
  Show one card per artist, or only the user's city, and fill the row.
- **All events:** remove "Show more events" (keep "See all events →").
  5 filters + Sort (now 3). Count says "Across Australia" while the location
  is Caulfield East.
- **Find your people:** the Art community has no photo and says "No upcoming
  events". Don't show empty communities on the homepage.

### Event page

- **Two ticket boxes:** the sticky panel (orange Buy tickets) and a second
  "Tickets" box below with a **black** Buy tickets. Remove the second box.
- **Address shown twice** ("170 Russell Street / 170 Russell St"); the venue
  name is missing. Show venue name + address.
- **Who's going:** shows "3 going" with no avatars; "I'm going" button is
  small. Add the avatar row; Secondary button M 48.

### Nearby

- List items still show the date. Remove it (same rule as the cards).

### Community

- The page is live, but the meeting agreed to hold it (likely app-only).
  Confirm with Dhruv whether it stays.
- Photo collage shows grey boxes for a few seconds while loading. Lazy-load
  with a blurred placeholder, or smaller images.

### Sign in

- **The sign-in card is too big.** Make it fit its content: max width
  **480**, padding **40** (32 on mobile), no fixed height, centred on the
  photo.
- **Type inside the card is too big.** Use these sizes:

| Text | Desktop | Mobile |
| --- | --- | --- |
| Title ("Welcome to Sheltüh") | 32 / 40 Bold | 24 / 32 Bold |
| Subtitle | 16 / 24 Regular, grey | 16 / 24 |
| Field label | 14 / 20 Medium | 14 / 20 |
| Input text | 16 / 24 | 16 / 24 (stops iPhone zooming in) |
| Buttons (Continue, Google, Apple) | M 48, label 16 SemiBold | M 48 |
| Terms line, "New here? / Find my tickets" | 14 / 20 | 14 / 20 |

- Spacing inside the card: 8 between label and field, 16 between fields and
  buttons, 24 between groups (title · form · social · links).
- Everything else on the page stays as it is.

### Content

- Time zone label inconsistent: "8pm Sydney time" on some events, nothing on
  others. Use one rule (e.g. show the city time zone only when it differs
  from the user's).

## Annotated screenshots (owner, 16 Nov 2026)

- Banner: "this black area should have 60% opacity"; "this image not
  complete" (the photo is cropped too tight).
- "is the spacing 88 px or 96px? do you think it is large?" (between the
  category chips and "This weekend").
- Homepage community tiles: Art shows a grey placeholder image.
- Event page: "this part is duplicated" (the second Tickets box).
- Sign-in: card too large.
