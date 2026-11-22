# Ticket email: "You're in. Here's your ticket." (implementation spec)

**Sources:** the owner's design images (18 Nov 2026):
- `153.png`: desktop and mobile side by side.
- `154.webp`: desktop.
- `155.webp`: mobile.
- `156.png`: the designer's notes, treated as requirements (§1).

**What the owner asked for:**
- Build the email **one-to-one with the images**, not as an interpretation.
- Leave the footer legal line out entirely.
- Keep QR codes inline, as today.
- Every Sheltüh ticket QR gets the ü logo in its centre (§6).
- Print the ticket type's name as entered, unabbreviated ("Second release"), at every width.
- Keep the Messages share button.
- Replace "Copy link" with "Share page".

The only differences from the images are the ones listed in §2, each with its reason.

**What it replaces:** `buildTicketEmail` in `lib/server/ticket-email.ts`. Today it uses the ivory "classic" layout
(`lib/server/email-layout.ts` `page()`, Nunito, a `#f1ede1` page and a `#fdf9e6` column). The other emails
**don't change**: those on `email-layout.ts` (onboarding, waitlist, follower, review, invite, free confirmation)
and those on `email-modern-layout.ts` (reminder, announcement).

---

## 0. How the values were measured, and what to re-check

**Scales.** The images were measured as supplied:
- The desktop frame is taken as a **600px email column** (scale ×1.132 from the screenshot).
- The mobile frame is taken as a **375px viewport** (scale ×1.103).

**Cross-checks.** The scales hold up against the measured image widths:
- Desktop: 600 − 2×32 page padding − 2×8 border − 2×28 ticket padding = **464px**, which is the measured image
  width.
- Mobile: 375 − 2×16 − 2×8 − 2×20 = **287px**, against 289px measured.

**Precision.** Sizes and spacing are ±2px, and type is ±1px. Colours were matched by eye to existing tokens: the
screenshots are compressed webp, so exact hex sampling isn't reliable.

**Before building:** open the original Figma frames, eyedrop every colour in §3.1, and check every number marked
≈. Where Figma differs, Figma wins. Record the corrected value in this file in the same PR.

**Corrected in the build (18 Nov), measured from the images.** The Figma frames weren't available, so the build
re-measured `154.webp` and `155.webp` pixel by pixel (both brought to 600 / 375px wide, ink rows and columns
compared against Chromium renders of the email). Where a value below differed by more than ±1px, the image won
and the email uses the measured value:

| What | Spec value | Built (desktop / mobile) | Measured from |
| --- | --- | --- | --- |
| Ticket border | 8px | **12px** (both) | 11–12px of orange each side at 600 and 375 |
| Ticket side padding | 28 / 20 | **24 / 16** | The content edge stays at 68 / 44px (464 / 287 wide) |
| Headline | 22/28, −0.01em | **24/30 / 23/28**, no tracking | Width 311px and ink height 24px at 600 |
| Ticket title | 30/36, −0.01em | **32/38 / 23/28**, no tracking | Width 201px, ink 25px |
| Stub labels / values | 10/12 / 16/24 | **11/12 / 17/24** (values 14/20 on a phone) | Ink heights; columns start **160px** apart (100 on a phone), TICKET takes the rest |
| Backup code / door note | 16/20 / 12/16 | **18/24 / 13/16** (both widths) | Ink heights |
| Page top | 36 / 32 | **34 / 33** | Wordmark at 33–34px |
| Order label → headline | 8 | **12 / 9** | |
| Header row → image → title → venue | 20 / 24 / 8 | **20 / 27 (25) / 10 (8)** | |
| Venue → perforation → stub | 36 / 32 (28 / 24) | **24 / 19 (16)**, measured to the row; the notch row is 24 tall, the dashes in its middle | Dashes at 604, labels at 636 (600 wide) |
| Info rows | 28 between rows | Lines 2 and 3 4px and 3px below the line before; **23** between rows; **32** after the last | Rows 102px apart |
| Summary | 32 before / after, 16 heading → rows, 16 → refund | **24 / 24, 12, 12** | |
| "Going with friends?" box | 8 / 16 / 24 | **7 / 14**, chips' 8px bottom margin + 14 | Box 155px tall |
| Need a hand → divider → footer | 40 / 32 | **32 / 24**; tagline 14, mono line 7 | Divider at 2053.5 |

**Re-measured (19 Nov).** The owner asked for an exact copy, so these were re-measured against `154.webp` and
`155.webp` with sub-pixel edge fits, and per-element fits of size and tracking in Chromium against the images. A
value changed only where both widths agreed and the change measured better:

| What | Was | Now (desktop / mobile) | Measured |
| --- | --- | --- | --- |
| Card radii | 20 outer / 12 inner | **15 / 7** (both widths) | Circle fits to the corner profiles at both widths (outer 15.0–15.3, inner 6.7–7.2) |
| Corner stripes | 112×12 / 72×12, bars 8 wide | **112×14 / 72×14**, bars **9** wide on an 18px pitch, 45° | Stripe block 215.9–230.0 at 600 (212.1–226.2 at 375); bar edges every 18px |
| Header row → image | 16 top / 20 | **17 / 16** (both widths) | The stripes start 1px lower, and the image starts 16px under them |
| Perforation | 2px dashes; 24 above (both widths) | **1.5px**; **22 / 24** above | Integrated darkness 1.47px; dashes at 603.4 (600) |
| Stub row above | 19 / 16 | **20 / 18** | Labels at 637.3 (600) and 529.0 (375) |
| Stub labels | 0.1em | **0.08em** | |
| Mobile headline / ticket title / stub values | 23 / 23 / 14 | **22 / 22 / 13** | Ink widths (283.5 vs 296.5 at 23px) |
| Mobile page top / label → headline | 33 / 9 | **34 / 10** | |
| "ADMIT ONE · SHELTÜH" | 10px, 0.12em | **11px, 0.08em** | |
| Info rows' link lines | 14px | **15px** | Both widths |
| "Order summary" | 20/28, −0.01em | **20/26**, no tracking; 14 to the first row | The heading sat 1.2px low at both widths |
| Order reference value | Mono 15, 0.04em | **Mono 16**, no tracking | |
| "Incl. booking fees", refund lines | 13px | **14px** | |
| "Going with friends?" line / "Need a hand?" | 16px | **15px** | Ink width 296.5 vs 323.5 at 16px |
| Footer mono line | 11px, 0.12em | **12px, 0.06em** | |
| "View your ticket" radius | 6 | **8** | |
| "Manage order" stroke | Drawn with square corners | Its table now has `border-collapse:separate`, so the 6px radius shows | A collapsed-border table ignores `border-radius` |

Everything else is as specified. The QR area is taller than drawn by design (P2): its 4-module white margin is
32px above and below the modules (28 on a phone), against ≈24 above and ≈12 below in the images.

## 1. The designer's notes (requirements)

1. **References.** The ticket's shape comes from colour-block ticket cards: an inset image, a big title, an info
   band, a perforated stub and a round notch on each side. The calendar, location and info rows, and the wallet
   buttons, come from Humanitix's order email. Use the principles only; copy nothing.
2. **Light only.** Keep `color-scheme: light` and `supported-color-schemes: light`, as both layouts do today.
3. **Fonts.** Instrument Sans (`'Instrument Sans', Arial, Helvetica, sans-serif`) and IBM Plex Mono
   (`'IBM Plex Mono', 'Courier New', monospace`).
   - Self-host them through `@font-face` on the site's own https origin, as `emailFontFace` does for Nunito today.
     Never use a third-party font host.
   - Most inboxes ignore web fonts (Gmail, Outlook); Apple Mail and iOS Mail load them.
4. **Bulletproof tables.**
   - The ticket is built from `role="presentation"` tables, with `bgcolor` and inline styles on every cell.
   - The notches and the corner stripe are small PNGs at 2×.
   - The perforation is `border-top: 2px dashed` on the stub's first cell.
5. **Add to calendar.** Three links:
   - Google: `calendar.google.com/calendar/render?action=TEMPLATE…`
   - Outlook: the designer wrote `outlook.live.com/calendar/deeplink/compose…`
   - Apple: the `.ics` download

   §5.7 says which helpers.
6. **Wallet buttons.** Use the official Apple and Google badges (the images' buttons are placeholders). The same
   ticket design should drive the wallet pass (§7).
7. **The QR in the images is a placeholder.**

## 2. Deviations from the images (the complete list)

| # | What | Image | Built | Reason |
| --- | --- | --- | --- | --- |
| D1 | Footer legal line | "Sheltüh Pty Ltd · ABN XX XXX XXX XXX · Naarm / Melbourne VIC" | **Removed**, with no replacement line | Owner, 18 Nov. The business is a sole trader, and no legal line is invented. |
| D2 | QR code | A placeholder version 1 symbol, no logo | The real code at **error-correction level H, version 2 (25×25 modules), with the ü mark in the centre** (§6) | Owner (centre logo). Level H is what lets the code survive the logo. The 13-character payload doesn't fit version 1 at level H, so the symbol becomes 25×25. |
| D3 | Real content instead of placeholders | A placeholder QR, the backup code "BPT7-7P6W", and black wallet buttons with a generic wallet glyph | The ticket's real QR and code, and the **official** "Add to Apple Wallet" and "Add to Google Wallet" badges | Designer's notes. The badges keep their vendors' proportions, so their widths follow the artwork rather than the image's 207 / 215px (§5.6). |
| D4 | The fourth share chip | "Copy link" | **"Share page"**, in the same chip style and position, linking to the event's public page, where the share and copy controls work | Owner, 18 Nov (approved). Email can't run the JavaScript that a copy button needs. |
| D5 | Mobile footer lines | "You're getting this email…" is **clipped** at both edges in `155.webp` | Wraps inside the column | A mock artefact: text must never be cut off. |
| D6 | Mobile ticket type | `155.webp` shows "2nd release" | **"Second release"**: the ticket type's name as entered, unabbreviated, at every width | Owner, 18 Nov. The desktop image already shows it. |
| D7 | Wallet buttons | Black one-line buttons with a generic wallet glyph, 207 / 215 × 48 | **The official badges** (20 Nov), both two-line ("Add to / Apple Wallet", "Add to / Google Wallet"), the same width at their own proportions (owner, 22 Nov): Apple 174 × 55, Google 174 × 48, 12px apart; 166px wide in a phone's halves. Hosted PNGs of the vendors' SVGs (not inline `cid:`), alt in the vendors' words, nothing behind them; with images off, the alt text shows in black. Apple's device note follows the last card's badges. | Apple's only badge is two-line, and Google's two-line badge matches it (`docs/wallet-setup.md`, "Official badges"). Apple's rules ask for the device note. The glyph was a placeholder. |
| D8 | Very large orders | – | One full card (the first ticket's) and a row for each other ticket; past a 90KB HTML budget the first rows are kept and the rest are one line pointing at the ticket page | Gmail clips HTML over 102KB. The largest order checkout allows is 20 types × 20 people = 400 tickets. Only the first code is in the email; the ticket page holds every code and QR code. |
| P1–P3 | (below) | | **Built** | Owner, 18 Nov: approved all three. |

**Accessibility deviations, approved by the owner on 18 Nov (Q1) and built.**

| # | What | Image | Proposal | Why |
| --- | --- | --- | --- | --- |
| P1 | Small orange text: "ORDER #A90133C9" (13px) and the venue line (11px) | `#FF4800` on white, **3.40:1** | `#D03E00` (`--signal-text`), 4.80:1, which looks almost the same | WCAG 1.4.3 needs 4.5:1 for text this size. Orange fills, borders, notches and the button stay `#FF4800`. |
| P2 | Space under the QR | The backup code sits ≈12px under the modules | A 4-module white quiet zone on all sides, so the code sits **32px** under the modules on desktop and 28px on mobile (+20 / +16px) | The QR standard requires a 4-module quiet zone, the logo already uses some of the error budget, and today's email keeps 4 modules. |
| P3 | "Add to calendar:" underlined | The whole line is underlined | The label in plain semibold; only "Google", "Apple" and "Outlook" are underlined links | Underlined text that isn't a link misleads people (WCAG 1.3.1 and 3.2.4). |

## 3. Tokens (email)

### 3.1 Colours (re-check against Figma, §0)

| Role | Hex | Site token (exact match) | Pairs and contrast |
| --- | --- | --- | --- |
| Page and column background | `#FFFFFF` | `--background` (Light) | – |
| Text; the wallet badges' black; perforation dashes; outline button stroke | `#000000` | `--foreground` / `--ink` | 21:1 on white |
| Signal: ticket border, notches, corner stripes, primary button fill, order label, venue line | `#FF4800` | `--signal` | Black on it 6.18:1; as text on white 3.40:1 (P1) |
| Secondary text: body line 2, summary labels, footer, mono labels | `#5C5C5C` | `--muted` | 6.69:1 on white, 6.48:1 on cream |
| Hairline dividers | `#E5E3DE` | `--surface-border` | – |
| Icon circles | `#F2F1EE` | `--surface` | Black icon on it 18.6:1 |
| "Going with friends?" box | `#FFFAE7` | `--hover` | Black 20.2:1; `#5C5C5C` 6.48:1 |

The light grey around the column in `153.png` is the **Figma canvas**, not the email. The body background is white
(§11.1, question 1).

### 3.2 Type (desktop / mobile ≤620px)

| Role | Family | Desktop | Mobile | Weight | Tracking | Case | Colour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Order label "ORDER #A90133C9" | Plex Mono | 13/16 | 13/16 | 500 | 0.08em | Upper (as written) | `#FF4800` |
| Headline "You're in. Here's your ticket." | Instrument Sans | 22/28 | 20/26 | 700 | −0.01em | As written | `#000` |
| Ticket header "ADMIT ONE · SHELTÜH" | Plex Mono | 10/12 | 10/12 | 500 | 0.12em | Upper | `#000` |
| Ticket title "HERE & NOW" | Instrument Sans | 30/36 | 24/30 | 700 | −0.01em | **As entered** (the sample is in capitals) | `#000` |
| Venue line "INTERCONNECT STUDIO · COBURG NORTH" | Plex Mono | 11/16 | 10/14 | 500 | 0.12em | `text-transform:uppercase` | `#FF4800` |
| Stub labels "DATE / TIME / TICKET" | Plex Mono | 10/12 | 10/12 | 400 | 0.10em | Upper | `#5C5C5C` |
| Stub values "Sat 14 Nov" | Instrument Sans | 16/24 | 14/20 | 500 | 0 | As written | `#000` |
| Backup code "BPT7-7P6W" | Plex Mono | 16/20 | 14/20 | 600 | 0.15em | Upper | `#000` |
| Door note "Show this at the door · ticket 1 of 1" | Instrument Sans | 12/16 | 12/16 | 400 | 0 | Sentence | `#5C5C5C` |
| Buttons "View your ticket →", "Manage order" | Instrument Sans | 16/20 | 16/20 | 600 | 0 | Sentence | `#000` |
| Info row line 1 | Instrument Sans | 16/24 | 16/24 | 600 | 0 | As written | `#000` |
| Info row line 2 | Instrument Sans | 16/24 | 16/24 | 400 | 0 | As written | `#5C5C5C` |
| Info row link line | Instrument Sans | 14/24 | 14/24 | 600 | 0 | Sentence, underlined (offset 2px) | `#000` |
| "Order summary" | Instrument Sans | 20/28 | 20/28 | 700 | −0.01em | Sentence | `#000` |
| Summary rows | Instrument Sans | 16/24 | 16/24 | 400 (label `#5C5C5C`, value `#000`) | 0 | – | – |
| Order reference value "#A90133C9" | Plex Mono | 15/24 | 15/24 | 600 | 0.04em | Upper | `#000` |
| "Total paid" row | Instrument Sans | 16/24 | 16/24 | 700 | 0 | – | `#000` |
| "Incl. booking fees", refund text | Instrument Sans | 13/20 | 13/20 | 400 | 0 | Sentence, **right-aligned** | `#5C5C5C` |
| "Going with friends?" | Instrument Sans | 18/24 | 18/24 | 700 | 0 | – | `#000` |
| Box line | Instrument Sans | 16/24 | 16/24 | 400 | 0 | – | `#5C5C5C` |
| Share chips | Instrument Sans | 14/20 | 14/20 | 600 | 0 | – | `#000` |
| "Need a hand?" line | Instrument Sans | 16/24 | 16/24 | 400 (link underlined) | 0 | – | `#000` |
| Footer tagline | Instrument Sans | 14/20 | 14/20 | 400 | 0 | – | `#5C5C5C` |
| Footer "SHELTÜH · MELBOURNE" | Plex Mono | 11/16 | 11/16 | 400 | 0.12em | Upper | `#5C5C5C` |
| Footer links, "why you got this" | Instrument Sans | 12/16 | 12/16 | 400 (links underlined) | 0 | – | `#5C5C5C` |

The site's rules (no mono capitals; never upper-case a venue in CSS) are **site** rules. The owner asked for this
email one-to-one, so the email follows the images. The plain-text part stays as entered.

### 3.3 Spacing, borders and radii

**Page:**
- Column 600px. Page padding 32px each side on desktop, 16px on mobile.
- Above the wordmark: 36px on desktop, 32px on mobile. Under the footer: 40px.

**Ticket:**
- Border **8px solid `#FF4800`**.
- Outer radius 15px, inner radius 7px (re-measured, §0; first specified as 20 / 12). Outlook drops the radii, which is
  acceptable.
- Inner padding: 16px at the top. Sides 28px on desktop, 20px on mobile. 24px at the bottom.
- Event image radius 4px.

**Controls:**
- Buttons: radius 6px (≈, re-check).
- The outline button has a 1.5px `#000` stroke (Outlook rounds it to 1 or 2px).
- Chips: radius 8px, 1.5px `#000` stroke.

**Other:**
- Cream box radius 16px.
- Icon circles 40px, radius 50%.
- Dividers 1px `#E5E3DE`.

## 4. Layout, top to bottom, with exact sizes (desktop / mobile)

```
body bg #FFF · table 100% · centre column max-width 600 (MSO: fixed 600 table)
└ td padding 36 32 40 32  (mobile 32 16 40 16)
  1  wordmark PNG 106×24 (2× 212×48), alt "Sheltüh", left                  gap 40
  2  order label  "ORDER #A90133C9"                                       gap 8
  3  h1           "You're in. Here's your ticket."                         gap 32
  4  TICKET CARD (×N, §5.1)                                                gap 32
  5  wallet badges row (per ticket, under its card)                        gap 32
  6  buttons row: [View your ticket →] [Manage order], equal halves, gap 12 (mobile 8)   gap 32
  7  info rows ×3 (§5.7), 28 between rows                                   gap 40
  8  divider                                                                gap 32
  9  "Order summary" + rows (§5.8)                                          gap 32
  10 divider                                                                gap 32
  11 cream box "Going with friends?" (§5.9)                                 gap 32
  12 "Need a hand? support@sheltuh.com.au"                                  gap 40
  13 divider                                                                gap 32
  14 footer, centred (§5.10)
```

**Mobile (≤620px).** These values come from classes in a `<style>` media query; the inline desktop values are the
fallback.
- Sides 16.
- Headline 20/26.
- Ticket sides 20, title 24/30, venue line 10/14, stub values 14/20, QR modules 7px.
- Buttons 48px tall.
- Wallet badges: two equal halves, gap 8.
- Share chips wrap, two per row at 375, as drawn.

The Gmail app with non-Google accounts ignores media queries. There, the fluid desktop layout scales down, because
every width is `width:100%; max-width:…`.

## 5. Components

### 5.1 Ticket card (one per issued ticket code)

Desktop: outer 536px, inner 520px, content 464px. Mobile: 343 / 327 / 287.

| Part | Spec (desktop / mobile) | Now (`ticketPanel`) |
| --- | --- | --- |
| Frame | A table with `bgcolor="#FF4800"` and padding 8px (the border, so Outlook draws it), radius 20. Inside it, a table with `bgcolor="#FFFFFF"`, radius 12. | White, 1px black border, radius 8 |
| Header row (padding-top 16; built 17, §0) | Left: the **corner stripes** PNG, **112×12** / 72×12 (2×: 224×24 / 144×24; built 112×14 / 72×14 with 9px bars, §0), `alt=""`: seven / five `#FF4800` bars slanted at 45°, each ≈8px wide with ≈6px gaps. Right: "ADMIT ONE · SHELTÜH" (§3.2), right-aligned and vertically centred. | "Your ticket" + "Ticket n of N" |
| Gap 20 / 16 | | |
| Event image | `width` 464 / 287, height auto at **2:1** (232 / 144), radius 4, `alt="Event image for {title}"` (as today). Same public URL as today (`eventImageEmailUrl`), so it's fetched once for N cards. **No image:** leave the row out, and the title follows the header row after 24px. An email can't draw EventArt's poster; a server-rendered poster PNG is an optional dependency (§11). | A full-width hero above the details (not in the ticket) |
| Gap 24 / 20 | | |
| Title | The event title, centred (§3.2), `overflow-wrap:break-word` | The h1 is the title |
| Gap 8 | | |
| Venue line | `{venueName} · {suburb}`, centred, upper case, `#FF4800`. If only one part exists, show it alone. If neither exists, leave the row out. | – |
| Gap 36 / 28 | | |
| Perforation row | A 3-cell row: **left notch**, **dashed**, **right notch**. Each notch cell is 12 wide and holds a half-disc PNG, 12×24 (2×: 24×48), `#FF4800`, flat edge against the border, `alt=""`, `bgcolor="#FFFFFF"`. The middle cell is `border-top:2px dashed #000000; height:0; font-size:0; line-height:0`, inset by the card's side padding minus 12, so the dashes run content edge to content edge (464 / 287 wide). The notches are vertically centred on the dashed line. The dash length is the client's own (CSS can't set it); expect ≈6/4. | `border-top:1px dashed` in muted, full width |
| Gap 32 / 24 | | |
| Stub row | Three equal columns (155/155/154 / 96/96/95). Each is a label (§3.2), a 4px gap, then a value. **DATE** `Sat 14 Nov` (`formatEventDateShort`, the event's zone). **TIME** `5–9 pm` (§5.2). **TICKET** the ticket type's name **as entered, never abbreviated** (`ticketNameWithGroup`): "Second release" at every width (D6). Values wrap; they're never truncated. | – |
| Seat (reserved seating only) | One more row, full width, after a 16px gap. Label "SEAT", value `formatSeatLine(seat)`. | The seat line in bold |
| Gap 0 | The QR PNG's own quiet zone is the gap (32 / 28). | |
| QR | The PNG with the logo (§6), shown at **264×264 / 231×231** (33 modules × 8 / 7px; the modules span 200 / 175, as drawn). Centred. `alt` = `ticketQrAlt(code)` (as today). Inline `cid:` (as today). | Shown at 232, version 1, no logo |
| Gap | The quiet zone (P2). If P2 is declined: 12, with a 2-module quiet zone at the bottom instead. | |
| Backup code | The code (§3.2), centred, selectable text | "Backup code" label + code |
| Gap 8 | | |
| Door note | `Show this at the door · ticket {n} of {N}` | "Show this code at the door." |
| Padding-bottom 24 | | |
| Event no longer listed | Show the header row, title, stub (TICKET column only), QR, code and note. **No image, venue line, DATE or TIME**, and no wallet badges (today's rule). The info rows are replaced by `EVENT_UNLISTED_TEXT` (§5.7). | Same rule |
| No QR (a code that isn't canonical) | The QR row is left out. The code is shown at 24/32 with "Entry code" as its label (today's rule). | Same |

### 5.2 Time formats (new, word for word as in the images)

**Stub TIME:**
- Same meridiem, whole hours: "5–9 pm".
- With minutes: "7:30–11 pm".
- Different meridiems: "11 am–2 pm".
- No end time: "5 pm".
- Overnight: "9 pm–2 am" (the day is in DATE).
- No spaces around the en dash, and one space before am/pm.

**Info row line 2:** "5:00 – 9:00 pm AEDT". The first meridiem is dropped when both times share it, and there are
spaces around the en dash. Otherwise use today's `formatTicketTime`. Multi-day events keep today's "Starts … /
Ends …" lines (`ticketWhen`).

Add both as functions beside `formatTicketTime`. Today's strings change only in this email.

### 5.3 Header (rows 1–3)

- **Wordmark:** the existing inline PNG (`wordmarkImage()`, cid), at 106×24.
- **Order label:** `ORDER ${orderReference(order.orderId)}`.
- **Headline:** "You're in. Here's your ticket." for one ticket. For more than one, "You're in. Here are your
  tickets." (following the design's pattern; it shows only one). Use the typographic apostrophe ’.

### 5.4 Several tickets (group tickets, several types)

- **One full card, the first ticket's** (Latte's 1120 "2-ticket order" frame, owner decision Nov 2026). Tickets come
  in today's order (ticket type, then code); the card is complete: header, image, title, venue, stub, QR, code,
  and "ticket 1 of N". Only its QR is attached.
- Each other ticket is a cream row (radius 8, 16/24 padding): "TICKET n of N" (Plex Mono 12/16, muted), then the
  buyer's checkout name and the ticket type (and seat) at 16/24 600, and a "View" link to the ticket page (it has
  no per-ticket address). No code or QR: the ticket page holds them. "Send to …" waits for ticket sending.
- Under the rows: "Each ticket has its own QR code. Swipe between them in your ticket."
- The first ticket's wallet badges sit under the card (one ticket) or under that line (several), as the frames
  place them; the other tickets' passes are on the ticket page.
- The buttons, info rows, summary, share box and footer appear **once**. With N > 1, the button reads "View your
  tickets →".
- **Size budget.** Gmail clips HTML over 102KB (inline attachments don't count). Test with the largest order
  checkout allows. Past 90KB (`TICKET_EMAIL_HTML_BUDGET`), the first rows are kept and the rest are one line
  pointing at the ticket page (D8).

### 5.5 Buttons row

- **"View your ticket →"** (arrow `&rarr;`):
  - A cell with `bgcolor="#FF4800"`, radius 6, black label.
  - Height **56px** on desktop (`padding:18px 16px`, with the same `mso-padding-alt`), 48px on mobile.
  - Width (536−12)/2 = 262 on desktop, (343−8)/2 = 167.5 on mobile.
  - One line at every width (`white-space:nowrap`, both buttons): on a phone the label is 16/24 with 12px padding
    (Latte's 375 frame), so "View your tickets →" and "Manage order" sit side by side in 343px. Under 360px (a 320px
    phone) they stack, full width, 8px apart. The arrow has no size of its own: it takes the label's (18px, 16px
    on a phone).
  - Links to `ticketPageLink`.
- **"Manage order"**: white, 1.5px `#000` stroke, the same size. It links to the order's existing ticket page,
  `ticketPageLink`, the link the email has always carried (Q2, owner, 18 Nov).
- Today's text fallback ("Button not working? Open your ticket here.") stays **only in the plain-text part**. The
  image has no fallback line.

### 5.6 Wallet badges

**Artwork.** Use the official badges (designer's note; `docs/wallet-setup.md`, "Official badges"):
- Apple: the "Add to Apple Wallet" badge, black, en-AU/en-GB.
- Google: the "Add to Google Wallet" badge, black/dark, en.

**Size.** Each is a 2× PNG, both shown **174px wide** (Google's 48px tall, the images' 47.5; owner, 22 Nov), each
with its height set by its own aspect ratio (Apple's 55), not a fixed 207 / 215 × 48.
- Desktop: the two badges are centred on each other, with a 12px gap.
- Mobile: both 166px wide, each centred in half of the row, with an 8px gap, keeping the artwork's ratio rather
  than stretching it.

**Usage rules (constraints):**
- Use the vendor-supplied artwork unmodified: no recolouring, re-typesetting, cropping or effects.
- Keep the minimum size and clear space from the vendor guidelines.
- Use the black badge on white.
- The badges replace the placeholders' generic wallet glyph and text.

**Alt text.** The vendor's exact phrase, "Add to Apple Wallet" / "Add to Google Wallet". When N > 1, add ": ticket
n of N" (as `WalletButtons.tsx` names them).

**Embedding.** Inline `cid:` PNGs, so these essential actions show even with images blocked. With images off, the
alt text shows inside a black cell with white text (`bgcolor="#000000"`, alt styled white 14/20 600).

**When they show.** Only when today's rule passes: a paid order, a published event, and the wallet enabled
(`ticketWalletLinks`). The links go to `walletPassLink`, unchanged.

### 5.7 Info rows (three)

Each row is a two-column table:
- Column 1 is 40px wide: a **40px circle** (a cell with `bgcolor="#F2F1EE"`, radius 50%) holding a 20px icon PNG
  (2×, black, 1.5px stroke, `alt=""`).
- Then a 16px gap, then the text column.

| Row | Icon | Line 1 | Line 2 | Link line |
| --- | --- | --- | --- | --- |
| When | Calendar (the existing `public/email/icons/calendar.png`, redrawn in 1.5px black to match) | `Saturday 14 November 2026` (`formatTicketDate`) | `5:00 – 9:00 pm AEDT` (§5.2) | `Add to calendar:`, then `Google · Apple · Outlook` (P3). See the links below. |
| Where | Pin (the existing `pin.png`, redrawn) | `Interconnect Studio` (the venue name) | `16 Catherine St, Coburg North VIC`: the address, suburb and state, leaving the suburb out when the address already names it (as `passAddress`) | `Get directions ↗` (`ticketDirectionsLink`, as today); the line is left out when that's null |
| Event info | **Info** (new: an "i" in a circle) | `Event info` | `Line-up, door times and what to bring` | `View event page`, linking to `eventPublicLink` |

**Calendar links (When row):**
- **Google:** `googleCalendarUrl` (`lib/calendar.ts`). It already builds
  `calendar.google.com/calendar/render?action=TEMPLATE`.
- **Apple:** `${site}/events/${slug}/calendar.ics`. That's the existing route: `inline` text/calendar, published
  events only.
- **Outlook:** `outlookCalendarUrl`. Today it builds `outlook.live.com/calendar/0/action/compose?…`; the designer
  named `…/calendar/deeplink/compose`.
  - Use **one helper** for both, so the site's AddToCalendar and the email always match. Switch it to
    `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&…`
    (Microsoft's documented deeplink), and test both surfaces.

**Not listed:** the three rows are replaced by one paragraph, `EVENT_UNLISTED_TEXT`, with the support link (as
today).

**New in this email:** the calendar links and the Event info row. Today's email only has directions.

### 5.8 Order summary

| Row | Left | Right |
| --- | --- | --- |
| Reference | `Order reference` | `#A90133C9` (mono) |
| One per `lineItems` entry | `{quantity} × {ticketTypeName}` (`×` is U+00D7; the name as entered) | The all-inclusive line amount (`formatAud`): `lib/fees.ts`'s buyer total per ticket (the same function checkout uses) × quantity |
| Support Sheltüh (not drawn; when the buyer added some) | `Support Sheltüh` | Amount (as today) |
| Total | **Total paid** | **A$25.94**, or **Free** |

**Spacing:** rows are 36px apart (24px line + 12px).

**Under the total:**
- `Incl. booking fees`, right-aligned. With Support Sheltüh: "Incl. booking fees and Support Sheltüh" (today's
  wording). Not shown for a free order.
- 16px below that, the refund paragraph, right-aligned:
  `{refundTermsLine} You can still get a refund if the event is cancelled or significantly changed, as the
  Australian Consumer Law requires.`
  - The image's first sentence is today's `no_change_of_mind` line.
  - The second sentence is the site's shared `REFUND_ACL_STATEMENT` ("You're always entitled to a refund if…"),
    not the image's wording (Q3, owner, 18 Nov: one wording everywhere).
  - Shown only when today's `ticketEmailRefundPolicy` rule passes. With Support Sheltüh, today's
    `SUPPORT_REFUND_NOTE` follows it.

**Integrity check:** if the line amounts don't add up exactly to `totalCents − supportCents`, show the line items
**without** amounts. Never print numbers that disagree with the total.

### 5.9 "Going with friends?"

**Box:** `bgcolor="#FFFAE7"`, radius 16, padding 24.

**Contents, top to bottom:**
- Heading.
- 8px, then the line "Send them the event so you can go together."
- 16px, then the chips.

**Chips:** 40px tall, padding 0 16, radius 8, 1.5px `#000` stroke, white fill, 8px apart. They wrap: one row on
desktop, two per row at 375.

| Chip | Link (an email can't run JavaScript) | Works where |
| --- | --- | --- |
| WhatsApp | `https://wa.me/?text=…` (today's `tellAFriendLinks`) | Wherever WhatsApp or WhatsApp Web is available |
| Messages (kept: owner) | `sms:?&body=…`, with the invite and the event link in the body (today's) | Phones (iOS, Android). Desktop mail clients either do nothing or ask which app to use. |
| Email | `mailto:?subject=…&body=…` (today's) | Everywhere |
| **Share page** (D4, approved) | The event's public page (`eventPublicLink`), where the share and copy controls work | Everywhere |

Shown only for a listed event (today's rule). The invite text is unchanged (`inviteText`). The plain-text part
lists all four links.

### 5.10 Footer

**Centred, top to bottom:**
- The wordmark PNG at 88×20 (the same asset, cid).
- 12px, "Find your place, find your people."
- 8px, "SHELTÜH · MELBOURNE".
- 8px, the links: `Privacy policy` → `/privacy`, `Terms` → `/terms`, `Help centre` → `/help`, separated by ` · `.
- 8px, "You're getting this email because you bought a ticket on Sheltüh."

**No legal line** (D1). The "Need a hand?" line sits **above** the footer divider (row 12), as drawn. Today's
`brandFooter` image banner (`sheltuh-email-footer.png`) isn't in the design, so it isn't used here.

## 6. QR codes with the ü logo (all Sheltüh ticket QR codes)

**Scope:**
- The ticket email (a PNG: `lib/server/ticket-email.ts` + `lib/server/png.ts`).
- The ticket and confirmation pages (an SVG: `components/tickets/TicketQr.tsx`, used by `TicketStub`).
- The wallet-handoff QR on My ticket (`my-ticket.md` §5.8).
- Any future ticket QR.
- The owner said "all Sheltüh QR codes". The admin campaign QR (`components/admin/CampaignQr.tsx`) isn't a ticket,
  so apply the logo there too only if the owner confirms (Q4).

**What stays as it is today:**
- QR codes stay **inline in the email**: a `cid:` PNG attachment per ticket, built fresh on every send attempt,
  with nothing stored.
- The attachment filename is never the code (`ticket-n-qr.png`).
- The alt text is `ticketQrAlt`, and the backup code is printed as text.
- The payload is unchanged: `SH1:` + the code.

**Rules:**
1. **Error correction: level H** (about 30% recovery), set in `ticketQrMatrix` (today it's Q). At H, the
   13-character alphanumeric payload needs **version 2 (25×25)**, because version 1-H holds only 10 characters.
2. **Logo area:**
   - A centred square of **7×7 modules** (7.8% of the symbol's area) is cleared to light. On version 2 it's
     also the largest centred square that clears every function pattern: 9×9 already reaches the format
     information at (8, 8) and the alignment pattern at (16, 16).
   - Inside it, a **1-module white pad** surrounds a **5×5-module** box that holds the ü mark.
   - The owner's ceiling is about 20% of the code. On version 2, never exceed **9×9 modules (13%)**.
   - In the centre, the 7×7 square (modules 9–15) misses the finder patterns, the timing patterns (row and column
     6) and version 2's alignment pattern (centred at 18,18). The code must assert this.
3. **The mark:** the brand's ü (`public/brand/sheltuh-u.svg` / `components/brand/marks.ts` `U_MARK`), black
   `#000000` on white, centred, scaled to fit 5×5 modules with its proportions kept. It isn't orange: scanners need
   contrast, and the orange is reserved.
4. **Part of the image, never an overlay** (an email client could drop an overlay):
   - Email PNG: composited on the server with `sharp` (already a dependency). Render the matrix (today's
     `encodePng`), rasterise `sheltuh-u.svg` to 5 modules × 16px, then composite it at the centre.
     *As built:* `scripts/render-ticket-qr-mark.ts` rasterises the ü with sharp once (80×80, thresholded at half
     coverage) into `lib/server/ticket-qr-mark.ts`, and `lib/server/qr-image.ts` composites it into the 1-bit
     PNG synchronously, so `buildTicketEmail` stays synchronous (sharp has no synchronous API) and every pixel
     stays pure black or white. The decode suite re-rasterises the SVG with sharp and checks the stored bitmap
     still matches.
   - Page SVG: draw the cleared matrix plus the mark as a `<path>` in a nested `<svg>` at the centre.
5. **Sizes.** A version 2 symbol is 33 modules wide including the quiet zone.

   | Where | Pixels per module | Size |
   | --- | --- | --- |
   | Email PNG file | 16 | 528×528 |
   | Email, desktop | 8 | shown at 264 |
   | Email, mobile | 7 | shown at 231 |
   | Ticket page, below 375px wide | 7 | 231px (was 203) |
   | Ticket page, from 375px | 8 | 264px (was 232) |
   | Print | – | 40mm |

   Update `TicketQr.tsx`'s plate sizes and its comment.
6. **Verification (required, in CI).** A Vitest suite decodes every generated image with a real decoder: `zxing-wasm`
   (which comes with `barcode-detector`, the dependency the door scanner already uses). It must cover:
   - 200 random canonical codes plus the fixtures. Each decodes to exactly `SH1:{code}`.
   - The email PNG at the sizes people see it, downscaled with `sharp` (Lanczos, threshold-free): 528, 264 and
     231, plus **141px** (Gmail scaling a 600px email onto a 320px screen) and **116px** (a 2.2× zoom-out worst
     case).
   - The `TicketQr` SVG rasterised at 231, 264 and 151px (40mm at 96dpi).
   - The same 231px image through the door's scanner path (`lib/check-in/detector.ts`, zxing wasm).
   - A unit assertion that the logo box never overlaps a function pattern.
   - A negative check: clearing a 13×13 box makes decoding fail. This proves the test can catch a logo that's too
     big.
7. **Wallet passes can't carry the logo.** Apple Wallet (`PKBarcodeFormatQR`) and Google Wallet (`QR_CODE`) render
   their own barcode from the payload string. There's no image and no centre logo, and each wallet picks its own
   error-correction level. So the pass QR stays plain. That's expected, not a bug.

## 7. Wallet passes: what can and can't follow the email

Today (already built):
- `lib/server/wallet/apple.ts`: eventTicket passes.
- `lib/server/wallet/google.ts`: the EventTicket class and object.
- `lib/server/wallet/brand.ts`: ivory `#fdf9e6`, ink and Signal.
- The strip and hero PNGs in `public/wallet/`.

| Email element | Apple (eventTicket) | Google (EventTicket) | Can it match? |
| --- | --- | --- | --- |
| White card, black text | `backgroundColor`, `foregroundColor`, `labelColor` (rgb) | `hexBackgroundColor`; Google chooses the text colour | **Yes.** Move `WALLET_COLOURS.ivory` to `#FFFFFF` and the label colour to `#5C5C5C`. |
| 8px orange border, radii, notches, perforation | Wallet draws its own shape (eventTicket has a semicircle cut-out at the top) | Google's own card | **No.** |
| Corner stripes, "ADMIT ONE · SHELTÜH" | The strip image (behind the primary field; 375×98pt, @2x/@3x) can carry the stripes | The hero image (1032×336) can carry them | **Partly**: as artwork in the strip/hero image, not as text. |
| Event image | The strip image could be the event's photo (cropped to about 3.8:1; needs per-event image processing) | `heroImage` per object can be the event image | **Partly**: needs a per-event image pipeline (backend, §11). Today the strip is a static brand image. |
| Title, venue | `primaryFields` (title), `secondaryFields` (venue) | Event name and venue (Google's template) | **Yes, as fields**, in the wallets' own fonts only: no mono, no orange text. |
| DATE / TIME / TICKET | `headerFields` (date), `secondaryFields` (time), `auxiliaryFields` (ticket) | `dateTime`, ticket type | **Yes**: today's `passDate` / `passStartTime`, and the compact "5–9 pm" can go in the time field. The ticket type is the name as entered. |
| QR with logo, backup code | Barcode `altText` = code | Barcode `alternateText` = code | **QR yes, logo no** (§6, rule 7). |
| Buttons, info rows, summary, share | `backFields` (address, order reference, links) | Text modules and links | **Only as text** on the back or details. |

**Change (optional increment E4):** a white background, `#5C5C5C` labels, and a new strip/hero PNG that carries
the corner stripes. The fields stay as they are, and nothing else is promised.

## 8. Email-client constraints (keep what works)

**Already handled today, and kept:**
- Table layout with inline styles.
- The `mso` conditional fixed-width wrapper, and `mso-padding-alt` on buttons.
- `color-scheme: light`.
- A hidden preheader with `mso-hide:all`.
- Inline `cid:` images for the wordmark and the QR codes, so they show even when remote images are blocked
  (Outlook's default).
- Real-text content: everything essential still reads with images off.
- Alt text on every image.
- A plain-text alternative.
- The outbox rebuilds the email on every attempt.

**New:**
- Web fonts, with the fallbacks from §1.
- A `@media (max-width:620px)` block for the mobile values.
- Decorative PNGs (stripes, notches, icons) hosted remotely on the site's own origin. Each has its `width` and
  `height` set, so a blocked image keeps the layout.
- With images off:
  - The notches and stripes show nothing; their cells are white.
  - The badges show their alt text in black cells.
  - The event image shows its alt text.
- **Dark mode:** light-only by declaration. Outlook.com and the Gmail iOS app may still force-invert colours. The
  orange frame (`bgcolor`) and the black-on-white QR stay readable through a partial inversion. Check this in the
  test matrix.

## 9. Plain-text part (rewritten in the email's order)

```
SHELTÜH

ORDER #A90133C9
You're in. Here's your ticket.

HERE & NOW
Interconnect Studio · Coburg North
Date: Sat 14 Nov · Time: 5–9 pm · Ticket: Second release

Ticket 1 of 1 — Entry code: BPT7-7P6W (show this at the door; the QR code is in the full email)
Add to Apple Wallet: {link}
Add to Google Wallet: {link}

View your ticket: {link}
Manage order: {link}
(Button not working? Use the links above.)

Saturday 14 November 2026, 5:00 – 9:00 pm AEDT
Add to calendar — Google: {link} · Apple: {link} · Outlook: {link}
Interconnect Studio, 16 Catherine St, Coburg North VIC
Get directions: {link}
Event info (line-up, door times and what to bring): {link}

ORDER SUMMARY
Order reference: #A90133C9
1 × Second release: A$25.94
Total paid: A$25.94 (incl. booking fees)
{refund sentence} {ACL sentence}

GOING WITH FRIENDS?
{inviteText}
WhatsApp: {link} · Messages: {link} · Email: {link} · Share page: {link}

Need a hand? support@sheltuh.com.au

Find your place, find your people.
Sheltüh · Melbourne
Privacy policy: {link} · Terms: {link} · Help centre: {link}
You're getting this email because you bought a ticket on Sheltüh.
```

For N tickets, repeat the ticket block once per ticket. An unlisted event and a free order follow today's rules.
Past the size budget (D8), the ticket blocks whose cards were left out of the HTML end "(show this at the door; its
QR code is on your ticket page)" instead, since their QR codes aren't in the email. A code with no QR (not
canonical) has neither clause.

## 10. Increments (each ships on its own; tests stay green)

**E1. QR with the ü logo** (`lib/ticket-qr.ts`, `lib/server/png.ts` or a new `lib/server/qr-image.ts`,
`components/tickets/TicketQr.tsx`, the tests in §6 rule 6). This ships into **today's** email and ticket page first;
it doesn't depend on the redesign.

*Accept:*
- Every decode test in §6 rule 6 passes.
- On a phone at 375, the ticket page QR is 264px with the ü in the centre.
- The door scanner (`/dashboard/{id}/check-in`; e2e with a fixture image) admits the ticket.
- The `tests/` that cover `ticketQrMatrix` (version 1 / level Q) are updated to version 2 / level H, not deleted.

**E2. New ticket-email layout:**
- A new `lib/server/email-ticket-layout.ts`: page shell, fonts, colours, header and footer helpers.
- `ticket-email.ts` moves onto it.
- New hosted PNGs in `public/email/ticket/`: stripes at 112×12 and 72×12, the notch half-discs, and the calendar,
  pin and info icons, all at 2×.
- The official wallet badges.
- Cards, badges, buttons, info rows with calendar links, the summary with line items, the share box (WhatsApp ·
  Messages · Email · Share page), the footer, and the plain-text part, all per §4–§9.
- The owner's answers to Q1–Q3 (18 Nov) are applied: P1–P3 built, "Manage order" → the ticket page, the shared
  ACL wording.

*Accept (all required):*
- **Visual one-to-one.**
  - Render a fixture order that matches the mock in headless Chromium (Playwright), with the web fonts loaded, at
    **600px and 375px** wide. Fixture: HERE & NOW; Interconnect Studio, Coburg North; Sat 14 Nov 2026, 5–9 pm AEDT;
    ticket "Second release" at both widths (D6); A$25.94; `#A90133C9`; one ticket.
  - Swap the event image for a neutral, licensed 2:1 placeholder. **The mock's poster is third-party artwork and
    can't be committed, even as a fixture.**
  - Put the two screenshots **side by side with `153.png` / `154.webp` / `155.webp`**, and attach them to the PR.
  - Run a **pixel diff** (e.g. `pixelmatch`, threshold 0.1) after aligning the frames, with the event image, QR,
    wallet badges and the fourth chip's label masked (D2, D3, D4, D6).
    - Target: **≤1.5% differing pixels** outside the masks at each width, and no differing region larger than
      24×24px.
    - Every remaining difference is either listed in §2 or fixed.
- **Client matrix** (Litmus or Email on Acid, or real devices): Apple Mail on macOS and iOS; Gmail web and the
  Gmail iOS and Android apps; Outlook 365 for Windows; Outlook.com; Yahoo.
  - The card frame, notches, perforation, QR, badges and buttons render.
  - Nothing overflows at 320px.
  - With images off, every essential piece (code, date, venue, total) still reads.
- HTML stays under 90KB for the largest allowed order. Each QR decodes from the delivered email (save the received
  PNG and decode it).
- **Accessibility:**
  - `lang="en-AU"`, one `h1`, and `h2` for "Order summary" and "Going with friends?".
  - `role="presentation"` on every layout table.
  - Alt text as specified; `alt=""` on decorative images.
  - Link text makes sense out of context ("Get directions", "View event page", and "Google" inside "Add to
    calendar:"). The calendar links carry `title="Add to Google Calendar"` and the like.
  - Contrast as in §3.1, with the P1 decision recorded.
  - Targets: buttons at least 48px tall; chips 40px with 8px gaps (≥24px under WCAG 2.5.8).
  - The plain-text part has every link and code.
- The existing `tests/` for `buildTicketEmail` are updated to the new structure, keeping their behaviour
  assertions: unlisted event, free order, Support Sheltüh, the refund rule, the wallet rule, seats.

**E3. Owner answers** (Q1–Q3): apply them. They're small copy and colour changes.

**E4. Wallet pass alignment** (optional, §7): a white background, `#5C5C5C` labels, and a stripe strip/hero image.

*Accept:* a pass added on an iPhone and on Android shows a white card with the stripes and a plain QR, and the
fields are unchanged.

## 11. Dependencies and out of scope

**Assets:**
- The official Apple and Google wallet badges, downloaded from the vendors, with their licence terms followed.
- Instrument Sans and IBM Plex Mono files for the email's `@font-face` (the site already ships both).
- Stripe, notch and icon PNGs, which Latte should export at 2×.

**Backend (optional):**
- A server-rendered EventArt poster PNG, for events without an image.
- Per-event strip and hero images for the wallet passes (§7).

**Photos.** The mock's event image (the "Here & Now" poster) is third-party artwork. It can't be used anywhere,
including in test fixtures; see `public/events/README.md`.

**Out of scope.** The other emails (free-order confirmation, reminder, announcement) keep their layouts. A
follow-up can bring the free confirmation's ticket block onto this card.

### 11.1 Questions for Latte
1. Is the light grey around the column in `153.png` the Figma canvas (assumed), or an email background?
2. Please export the corner stripes, the notch half-discs and the three icons as 2× PNGs. Please also confirm the
   button radius (6px measured) and the ticket border (8px measured).

## 12. Open questions for the owner

**Settled on 18 Nov:**
- Ticket type names print as entered: "Second release" (D6).
- The Messages share button stays.
- "Copy link" becomes "Share page" (D4).
- No legal line in the footer (D1).
- QR codes stay inline, with the centre ü (§6).

**Answered on 18 Nov (applied in the build):**
1. **Q1: the three accessibility fixes (P1–P3).** Approved: the darker orange (#D03E00) for the small orange
   text (large orange stays as drawn), the QR's white margin kept, no underline on the "Add to calendar:" label.
2. **Q2: "Manage order".** Links to the existing order page the email already uses (`ticketPageLink`,
   `/checkout/success?session_id=…`). Point it at the signed-in My ticket page's Manage order once that exists
   (`my-ticket.md`).
3. **Q3: refund wording.** The site's shared Australian Consumer Law wording (`REFUND_ACL_STATEMENT`), not the
   image's sentence.

**Still open:**
4. **Q4: the admin campaign QR.** It isn't a ticket, so it isn't changed: no centre ü (the owner's rule covers
   ticket QRs, and the build applies it to every one: the email and the confirmation/ticket page).
   *Recommend:* keep it plain. If the owner wants the mark there too, reuse `ticketQrSymbol`'s rules
   (level H, 7×7 clear) and add it to the decode suite.

## 13. Build record (18 Nov)

**Visual check.** The fixture in §10 E2 (with a neutral, self-made 2:1 placeholder for the event image) was
rendered in headless Chromium with the web fonts loaded, at 600px (in a 700px window) and 375px, device scale 2,
and compared with `154.webp` / `155.webp` brought to the same widths. Rows were aligned with a monotonic
row-to-row mapping (sections may shift; nothing may reorder), and the event image, QR, wallet buttons, the
fourth chip and (at 375) the ticket type were masked. pixelmatch, threshold 0.1, anti-aliasing excluded:

| Width | Differing pixels outside the masks | With a 1px shift tolerance (diagnostic) |
| --- | --- | --- |
| 600 | 3.84% | 1.34% |
| 375 | 6.02% | 2.45% |

The target (≤1.5%, no region over 24×24) isn't met. What remains is almost all text edges: Chromium's and the
design tool's rasterising of the same faces differs by sub-pixel amounts, the images are compressed webp, and
the 375 image is scaled ×1.103. The remaining larger regions are the deliberate deviations (P2's taller QR area,
D4–D8) and 1px differences at the card's frame. Real clients (§10 E2's matrix) haven't been checked.

**Re-check (19 Nov), after the re-measured values in §0.** This used a new harness, so the numbers aren't
comparable with the table above. Both versions were measured with it:
- The fixture rendered in Chromium (fonts loaded, device scale 2, 600 in a 700px window).
- Brought to 600 / 375 wide, with the reference upscaled to match.
- Rows aligned by a monotonic dynamic-time-warping map.
- pixelmatch at threshold 0.1, anti-aliasing excluded.
- The same masks: the event image, QR, wallet buttons, the fourth chip, and the ticket type at 375.

| Width | Before (18 Nov build) | After | At the image's own resolution (531 / 341 wide), before → after | After, also masking Q3's refund wording and P3's calendar label |
| --- | --- | --- | --- | --- |
| 600 | 4.71% | **4.42%** | 3.64% → 3.62% | 3.94% |
| 375 | 7.35% | **6.51%** | 5.96% → 5.04% | 5.88% |

The 1.5% target still isn't met, and changing the layout can't meet it:
- Lines that match in size and position, like "Saturday 14 November 2026" (the same ink width, within 0.5px),
  still have about a third of their box flagged. Figma's text rasterising differs from Chromium's, and the
  reference is a 531px webp scaled up ×1.13.
- Placing every pixel within 1px drops the figures to 0.77% / 1.22%.

Known differences left:
- **Strokes.** The 1.5px strokes (the chips, "Manage order", the perforation) show as 1px in Chromium, which
  rounds borders down. WebKit (Apple Mail) draws 1.5.
- **Arrows.** → and ↗ aren't in the self-hosted Instrument Sans subset (Google's "latin" range), so they fall back
  to a system arrow. The image shows a shorter, heavier arrow.
- **Owner decisions.** The deliberate deviations listed in §2 and §12.

**Wallet badges (20 Nov).** The official badges replaced the text buttons (D7), and Apple's device note now sits
under the last card's badges, one line not in the images. With the same harness and masks, the figures are
**4.80%** at 600 and **6.63%** at 375 (they were 4.42% and 6.51%). The difference is the note's line.
