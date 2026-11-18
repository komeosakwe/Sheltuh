# My tickets and My ticket: the signed-in ticket pages, their dialogs, sheets and states (implementation spec)

**Source images.** The owner's Figma boards, received 18 Nov 2026. Build them **one-to-one**. The only differences
are the ones listed in §2, each with its reason.

| Image | What it shows |
| --- | --- |
| `157.webp` | My ticket, desktop content |
| `158.png` | The whole page frame, "My ticket — Desktop 1440 · Light (signed in)" |
| `159.webp` | Manage order dialog |
| `160.png` | Send this ticket dialog |
| `161.webp` | Add to your phone's wallet dialog |
| `162.webp` | My tickets list, **768** |
| `163.webp` | Send this ticket over the 768 page |
| `164.webp` / `165.webp` | 768 dialogs: venue, order receipt, manage order |
| `166.webp` | 768 page, plus the "Add to calendar" dialog |
| `167.webp` | Phone page and its bottom sheets |
| `168.webp` | Overview board: show-ticket flow, full screen with 1 and 2 tickets, all ticket states, the phone list, and the recipient's accept page |

The header and footer are specified in `navigation-search.md`. The QR rules are in `ticket-email.md` §6.

**What it replaces.** Today a buyer's tickets live on `/checkout/success?session_id={orderId}`
(`components/CheckoutConfirmation.tsx`, `components/tickets/TicketStub.tsx`, `TicketQr.tsx`, `WalletButtons.tsx`).
That page is reached by its order-id capability, from the email. It has no account link and no "My tickets" list.
It stays as the capability page, so the email link keeps working. The new signed-in pages sit beside it (§9).

---

## 0. How the values were measured

**Frames.** Each frame was matched to a known width:

| Frame | Width | Scale | Images |
| --- | --- | --- | --- |
| Desktop | 1440 | ×1.389 | `157`, `159`, `161` (2000px wide) |
| Tablet | 768 | ×1.147 (`162`), ×0.786 (`164`), ×0.729 (`166`) | `162`, `163`, `164`, `166` |
| Phone | 390 | ×0.7615 | `167` |

**Cross-checks.** Each frame's measured widths add back up to its known width:
- Desktop: 64 margin + 536 left column + 64 gutter + 712 right column + 64 margin = 1440 (1312 of content, the
  site's column).
- Tablet: 32 + 343 + 32 + 329 + 32 = 768.
- Tablet list: 32 + 340 + 24 + 340 + 32 = 768.

**Precision.** Sizes and spacing are ±2px; type is ±1px. `168.webp` is too small to measure: values for its frames
come from the matching larger frames, and anything that can only come from `168` is marked **≈ (verify in Figma)**.
Colours are matched to existing tokens by eye. **Eyedrop the Figma file before building**, and record any
correction here.

**The header in these frames.** The desktop frames draw it 96px tall and the phone frames 64px. That's the
pre-Round 2 header. **Keep 72 / 56**, per `navigation-search.md` §5.1. It isn't a deviation from this page's
design: the header is a separate component.

## 1. Principles

1. **The ticket is the hero.** On desktop and tablet, the full ticket (orange card, black stub, QR) is always on
   screen. On phones, a compact card opens a **full-screen ticket**: the door view, with nothing else on it.
2. **One action surface per breakpoint.** Choices open as centred **dialogs from 768px**, and as **bottom sheets
   with a grab handle below 768px**, with identical rows in both.
3. **States speak in the card.** Every state (waiting, transferred, checked in, changed, cancelled, refunded,
   ended) is one white strip inside the card, in the same place, in words. Colour is never the only signal: past
   tickets are grey **and** say why.
4. **Nothing is promised that the data can't back.** A state or action shows only when the API can say it's true
   (§8).

## 2. Deviations from the images (complete list)

| # | What | Image | Built | Reason |
| --- | --- | --- | --- | --- |
| D1 | QR codes | placeholders with no logo | real codes, **level H with the centre ü** (`ticket-email.md` §6), on the ticket and on the wallet-handoff QR (§5.8) | Owner rule for all ticket QRs |
| D2 | Wallet buttons | black buttons with an orange square glyph | the **official** Apple and Google badges, unmodified, 40px tall on desktop and phone, widths from the artwork | Vendor rules, and the email spec's D3. The desktop image's 264px buttons become badge-width, each centred in its half. |
| D3 | Receipt legal line | "Includes GST of A$2.36. Issued by Sheltüh Pty Ltd · ABN XX XXX XXX XXX" | **left out** | Sheltüh is a sole trader. A GST line is valid only if the business is registered for GST. The owner left the legal line out of the email. Q1. |
| D4 | Receipt card details | "Visa •••• 4417" | **left out** until card brand and last 4 are stored (§8, B6) | That data isn't stored today. Never show a guess. |
| D5 | Sample data | desktop "PURCHASED 10 Nov 2026" vs receipt "Placed 12 Nov 2026"; receipt "A$23.00 + booking fee A$2.94" | the real order's values | The mock's numbers disagree with each other, and with the fee model (4% + A$0.50: a A$23.00 ticket has a A$1.42 fee, A$24.42 total). Only the layout is copied. |
| D6 | Copy that's only in a mock | "Turn your brightness up…" (kept); a full-screen caption about brightness rising automatically (if that's what it says; ≈) | the brightness **hint** text, plus Screen Wake Lock | The web can't change screen brightness. Only native apps can. Wake Lock keeps the screen on while the ticket is open. |
| D7 | Small orange text on white | "Order #A90133C9 Confirmed" (desktop/tablet), "From Alex Chen" (recipient) | `#FF4800` as drawn, **unless Q2 approves `#D03E00`** | `#FF4800` on white is 3.40:1, below AA for 14px text. The same question as the email's P1. |

Mock photos and posters ("Here & Now", the High Note shots, and the people on the past cards) are placeholders.
**None of them may ship** unless their provenance and permission are recorded in `public/events/README.md`. Real
pages show each event's own `imageUrl`, or EventArt when there isn't one.

## 3. Tokens

These use the site's existing tokens; there are no new colours. Contrast for each:

| Role | Token / hex | On | Contrast |
| --- | --- | --- | --- |
| Ticket card fill, notches, perforation, pin, backup code (on black) | `--signal` #FF4800 | black stub / white | backup code on black 6.18:1; perforation and notches are non-text |
| Card text on orange (labels, date, title, row) | black #000 | orange | 6.18:1 |
| Stub | black #000 (`--ink`) | – | white text 21:1; `--muted` Dark #A3A3A3 (labels, hint) 8.33:1 |
| QR tile | white #FFF, radius 8 | black stub | – |
| Page | `--background` white | – | – |
| Secondary text | `--muted` #5C5C5C | white | 6.69:1 |
| Card borders (right column) | 1.5px `--surface-border` #E5E3DE | – | non-text (the card isn't a control) |
| Map placeholder | `--surface` #F2F1EE | – | – |
| Past card fill | `--surface` #F2F1EE | – | black 18.6:1; `#5C5C5C` 6.03:1 |
| State strip | white | orange or grey card | text black 21:1 |
| Scrim | `--ink` at 40% over everything, header included | – | – |
| Dialog / sheet | `--card` white, radius 16 | – | – |

**Type.** Families are Instrument Sans (`--face-sans`) and IBM Plex Mono (`font-mono`). This page uses Plex Mono
for its facts, as drawn, overriding the site's 13 Nov "no mono" rule for this page **by the owner's one-to-one
instruction**. Mono text is set as written: sentence case, except where the image shows capitals.

| Role | Desktop 1440 | Tablet 768 | Phone 390 | Family, weight, tracking, case |
| --- | --- | --- | --- | --- |
| Back link "← My tickets" | 16/24 | 16/24 | 16/24 | Sans 600, arrow icon 16 |
| Card mono labels "SAT", "AEDT" | 11/16 | 11/16 | – | Mono 500, 0.08em, upper |
| Card date "14 NOV — 5–9 PM" | 28/32 | 20/24 | – | Sans 700, −0.01em, upper (the date is formatted in capitals; the em dash has spaces) |
| Card title | 36/40 | 24/28 | – | Sans 700, −0.02em, as entered |
| Stub lines | 14/26 | 12/20 | – | Mono 500, 0.02em, white, as written |
| "Show this at the door" | 16/24 | 13/20 | – | Sans 600, white |
| "BACKUP CODE" | 12/16 | 10/14 | – | Mono 500, 0.12em, `#A3A3A3`, upper |
| Backup code | 20/24 | 16/20 | – | Mono 600, 0.12em, `#FF4800` |
| Brightness hint | 14/20 | 12/18 | – | Sans 400, `#A3A3A3`, centred |
| Order line "Order #A90133C9 Confirmed" | 14/20 | 12/16 | – | Mono 500, 0.04em, orange (D7) |
| Page title | 48/52 | 32/36 | – | Sans 700, −0.02em, as entered |
| Facts lines (date/time; venue · suburb) | 14/28 | 12/20 | – | Mono 400, 0.02em, `#5C5C5C` |
| Card heading ("Add to calendar") | 20/28 | – | – | Sans 600 |
| Outline buttons | 16/24, 40px tall | – | – | Sans 600 |
| Row title / sub (right column, tablet and phone) | – | 15/22 · 12/18 | 16/24 · 13/20 | Sans 600 / 400 `#5C5C5C` |
| Details labels "TICKET / ORDER…" | 12/16 | – | – | Mono 400, 0.10em, `#5C5C5C`, upper |
| Details values | 16/24 | – | – | Sans 400; total 700 |
| Footer line | 14/20 | 12/18 | 13/20 | Sans 400, `#5C5C5C` |
| List: heading "My tickets" | – | 32/40 | 28/36 (≈) | Sans 700 |
| List: section "Upcoming · 3" | – | 20/28 | 20/28 | Sans 600 |
| Compact card date | – | 12/16 | 12/16 | Mono 400, black (orange card) / `#5C5C5C` (past) |
| Compact card title | – | 22/28 | 20/26 | Sans 700 |
| Compact card venue | – | 14/20 | 13/18 | Sans 400 |
| Compact card holder row | – | 14/20 | 12/16 | Sans 600; "1 OF 1" in Mono 500 12, 0.08em, upper |
| Dialog title | 22/28 | 20/28 | 20/28 | Sans 700 |
| Dialog subtitle | 14/20 | 13/20 | 14/20 | Sans 400, `#5C5C5C` |
| Dialog rows | title 16/24 600; sub 14/20 | the same | the same | – |
| Dialog footnote (refund note) | 13/18 | 11/16 | 11/16 | Sans 400, `#5C5C5C` |

**Radii.** Ticket card 20 (desktop), 16 (tablet and compact). Image 6 (desktop), 4 (tablet and compact thumb).
Stub 12. QR tile 8. Right-column cards 8. Buttons 6 (≈; verify). Dialogs and sheets 16. State strip 6.

## 4. Layout

**Desktop 1440** (`157`, `158`):
- Content starts 48px under the header. The back link "← My tickets" follows, then 32px.
- Two columns: **left 536** and **right 712**, with a **64 gutter**. Their tops align (the card's top = the order
  line's top).
- The page ends 64px below the taller column, then the footer.

**Tablet 768** (`166`): the same two columns, **343 / 329**, with a 32 gutter and 32 margins.
- The right column is the **row list** (map card + rows), as on the phone. It isn't the three desktop cards.

**Phone 390** (`167`): one column. Margins are **24** (≈; the footer uses 16. See §10, Latte Q2).
- Order: back link, **compact card** (with "Show ticket →"), wallet badges, map card, rows card, then the help
  line.

**List** (`162`, `168`):
- 768: two columns, 340 / 24 / 340, row gap 24.
- Phone: one column, full width (≈).
- From 1024: the design shows no list frame. Use **three columns** at L and XL in the site grid (`lg:grid-cols-3`,
  gutters 32). That isn't in the images: a recorded assumption (Latte Q3).

## 5. Components (desktop values first; tablet / phone where they differ)

### 5.1 Full ticket card (desktop left column, 536 wide; tablet 343; the phone's full-screen view)

```
div bg #FF4800 rounded-[20px] p-4 (16)                                    [tablet: rounded-2xl p-4]
  img event image  w-full aspect-[2/1] rounded-[6px] object-cover       504×252 | tablet 311×156 (≈ 2:1)
                    fallback: EventArt poster, same box
  mt-6 (24)  row: [SAT / 14 NOV] — [AEDT / 5–9 PM]
      labels Mono 11/16 500 0.08em upper; values Sans 28/32 700 upper
      second column starts 136px from the first (desktop), 88 (tablet); the em dash centred between, 28/32 700
  mt-2 (8)   title  Sans 36/40 700 −0.02em
  mt-7 (28)  STUB  bg #000 rounded-xl (12) px-6 (24) pt-6 (24) pb-8 (32)   [tablet px-4 pt-4 pb-6]
      mono lines (14/26 500, white):
        [phone/tablet only] "Ticket holder · {name}"     (shown when there's a holder name: §8)
        {venueName}
        {venueAddress, suburb}        (as drawn: "16 Catherine St, Coburg North")
        {ticketTypeName} · Ticket {n} of {N}
      mt-8 (32) perforation: 2px dashed #FF4800 (≈ 7px dash, 6px gap), spanning the content (24px in from each side)
        notches: two 20px discs #FF4800 centred on the stub's left and right edges, level with the perforation
        (the orange card shows "through" the stub)
      mt-8 (32) QR tile: white, 232×232, rounded-lg (8), p-4 (16) → the QR at 200×200 (version 2, 8px modules), centred
                 [tablet: 160 tile, 144 QR = 6px modules ≈; verify]
      mt-4 (16) "Show this at the door"  Sans 16/24 600 white, centred
      mt-6 (24) "BACKUP CODE" Mono 12/16 500 0.12em #A3A3A3, centred
      mt-1 (4)  code Mono 20/24 600 0.12em #FF4800, centred, selectable
      mt-4 (16) hint Sans 14/20 #A3A3A3, centred, max-w 446:
                "Turn your brightness up. If the QR code won't scan, door staff can type in the backup code."
mt-4 (16) wallet row: two equal halves, gap 8, each a centred official badge 40px tall (D2)
```

- **The QR's quiet zone.** The tile gives 16px of white, which is 2 modules. The QR standard asks for 4. The
  ticket-page QR must pass the decode suite (`ticket-email.md` §6.6) **at this tile**, with the black stub around
  it. If it fails, the tile grows to p-8 (32): a measured deviation, to be recorded here.
- **Checked in.** Over the QR tile, a centred white overlay (≈, `168`): a "✓ Checked in" line with the time
  ("Checked in 7:42 pm"), and the QR shown at 30% opacity behind it. It stays scannable: an undone check-in makes
  the ticket valid again, and the door decides (as TicketStub today).
- **Unlisted event.** No image, no date row and no venue lines. The stub says `EVENT_UNLISTED_TEXT`. No wallet
  badges. This is today's rule.
- **Event without an image.** EventArt fills the 2:1 box.
- **Accessibility.** The QR is `role="img"` with `aria-label="QR code for ticket BPT7-7P6W"` (`ticketQrLabel`).
  The card is a `<section aria-labelledby={title}>`. The date row reads as "Saturday 14 November, 5 to 9 pm AEDT"
  through an sr-only full sentence; the visual capitals are `aria-hidden`.

### 5.2 Right column, desktop (712 wide)

- **Order line.** "Order #A90133C9 Confirmed" (D7). "Confirmed" is the order status in words. Use "Refunded" for a
  refunded order. A cancelled event says "Event cancelled" (new data: §8).
- **Title.** 12px under the order line: 48/52, as entered.
- **Facts.** 16px under the title:
  - "Sat 14 Nov · 5:00 – 9:00 pm AEDT" (the email's format, `ticket-email.md` §5.2)
  - "Interconnect Studio · Coburg North"
  - Mono 14/28 `#5C5C5C`.
- **Cards.** 32px under the facts. Each is 1.5px `#E5E3DE`, radius 8, `p-6` (24), with **24px between cards**:
  1. **Add to calendar.**
     - Heading 20/28 600, then 16px, then three outline buttons, each 40px tall: `px-6`, 1.5px `#000`, radius 6,
       8px apart.
     - **Google Calendar** → `googleCalendarUrl`.
     - **Apple (.ics)** → `/events/{slug}/calendar.ics`.
     - **Outlook** → `outlookCalendarUrl` (the same helper the email uses).
     - Only for a listed event.
  2. **Getting there.**
     - Heading, then 16px, then the **map**: full inner width (664) × 200, radius 8.
     - The map: the event page's `EventLocationMap` (Leaflet + Esri), non-interactive, centred on the venue pin.
       The pin is the orange 16px dot as drawn.
     - **Placeholder** (`#F2F1EE` with the dot centred) while it loads, or when there's no pin.
     - Then 16px, the venue name (16/24 600), 4px, then the full address (16/24 `#5C5C5C`).
     - Then 12px, the links: "Google Maps ↗ · Apple Maps ↗" (14/20 600, underlined) → `directionsHref` /
       `appleMapsHref` (lib/maps.ts).
     - The map needs `location.pin` in the order API (B2).
  3. **Ticket details.**
     - Heading, then 16px, then rows 36px apart: label (Mono 12/16) left, value (16/24) right.
       - **TICKET**: "Second release · 1 of 1".
       - **ORDER**: "#A90133C9".
       - **PURCHASED**: "10 Nov 2026" (the order's date, B3).
     - A 1px `#E5E3DE` divider, 12px above and below.
     - **TOTAL PAID**: "A$25.94 incl. fees" (700; "Free" for a free order).
     - Then 16px, the links "View event page →" and "Manage order", 24px apart (16/24 600, underlined).
       "Manage order" opens §5.5.
- **Footer line.** 24px under the cards: "Need a hand? support@sheltuh.com.au · No refunds for change of mind —
  you're still covered by Australian Consumer Law." (14/20 `#5C5C5C`; the email address is a `mailto:` link).
  The refund sentence comes from the event's policy (`refundTermsLine`); "you're still covered by Australian
  Consumer Law." is this page's copy (verbatim).

### 5.3 Right column, tablet and phone: map card and rows card

- **Map card.** 1.5px `#E5E3DE`, radius 8.
  - Map 138 (phone) / 264 (tablet) tall, `#F2F1EE` placeholder or real map, top corners 8.
  - Then a row: venue name (15/22 600) over "16 Catherine St, Coburg North" (12/18 `#5C5C5C`), with ↗ on the
    right, `px-4 py-3`.
  - The whole row is a button that opens the **venue dialog or sheet** (§5.6).
- **Rows card.** 16px under the map card. 1.5px `#E5E3DE`, radius 8, four rows. Each row: `min-h-[68px]`,
  `px-4`, title over sub, and a chevron (16) on the right. There are no dividers between rows (as drawn).
  - **Add to calendar** — "Google · Apple · Outlook" → §5.7.
  - **Order #A90133C9** — "A$25.94 incl. fees · receipt" → the receipt (§5.9).
  - **Manage order** — "Transfer, resend or refund" → §5.5.
  - **Event page** — "Line-up and door times" → `/events/{slug}` (a link, with the chevron).
- **Help line.** 16px under the rows card: "Need a hand? support@sheltuh.com.au" (13/20 `#5C5C5C`).
- **Row hover and focus.** `bg-surface`. Press: `bg-surface-border`. The focus ring stays inside the card (an
  inset outline).

### 5.4 Compact ticket card (phone page, the list at every width)

```
div rounded-2xl (16) p-4 (16)  bg #FF4800 (upcoming) | bg #F2F1EE (past)          340 wide at 768 / full width on phones
  row gap-4: thumb 88×88 rounded (4) object-cover (past: grayscale(1)) | text column:
      date  Mono 12/16 "Sat 14 Nov · 5–9 pm"
      title Sans 22/28 700 (truncate 2 lines)
      venue Sans 14/20 (past: #5C5C5C)
  mt-4 row justify-between: "Alex Chen · Second release" Sans 14/20 600 | "1 OF 1" Mono 12 500 0.08em upper
  [state strip, mt-4, if any: §5.10]
  mt-4 "Show ticket →" button: black, h-14 (56), rounded-lg (8), Sans 16/24 600 white, arrow 16   (upcoming only)
```

- **"Alex Chen".** The ticket holder's name (§8: B4). Until that field exists, it's the order's `buyer_name` when
  set. With no name, the row shows only the ticket type.
- **The whole card isn't a link.** "Show ticket →" is the action. It opens the full-screen ticket on phones, and
  the My ticket page from 768.

### 5.5 Manage order (dialog from 768 / bottom sheet below)

Dialog: **480 wide**, padding **32**, radius 16, centred in the viewport, with a 40% scrim.
- Title "Manage order" 22/28 700, with a ✕ (20px icon in a 44px button) 32px in from the top-right corner.
- Then 8px, "Order #A90133C9 · 1 ticket" (14/20 `#5C5C5C`).
- Then 16px, the rows: title 16/24 600, then 4px, the sub 14/20, a chevron 16 on the right; 14px padding top and
  bottom (a two-line row is 76, a one-line row 56). Hover and focus: `bg-surface`, radius 8, extended 12px past the
  text.
- Then 24px, the note "No refunds for change of mind. You can still get a refund if the event is cancelled or
  significantly changed." (13/18 `#5C5C5C`; `refundTermsLine` + this page's sentence).
- Bottom padding 32.

**Sheet** (below 768, `167`):
- Full width, radius 16 at the top, a grab handle (40×4 black, radius 2, 8px from the top), `px-6 pt-6`.
- The same content, then a **"Close"** outline button (full width, 48 tall, 1.5px black, radius 8) 24px under
  the note, and `pb` = 24 + safe area.

| Row (copy verbatim) | Exists today? | Behaviour |
| --- | --- | --- |
| **Send ticket to a friend** — "They get their own QR code; yours stops working" | **No: NEW** (transfer, §7) | opens Send this ticket (§5.11) |
| **Change ticket holder name** | **No: NEW** (B4; no per-ticket name exists) | opens a one-field form (as Send, with "Holder name"), ≈ not drawn |
| **Resend confirmation email** — "To the email you bought with" | **Partly.** Only admins can resend (`POST /admin/emails/{jobId}/resend`). There's no buyer self-serve route. | NEW route: re-queue the ticket email for this order to `buyer_email`, rate-limited (e.g. 3 per order per day), then a toast "Sent to m***@example.com" (`maskedEmail`) |
| **Contact organiser** — "Here & Now Collective" | **No.** There's no buyer→organiser channel. Members can message members, and organisers broadcast to holders. | NEW decision (Q5): a `mailto:` to an organiser contact address (new field), or a message thread (larger). The sub is the organiser's name (`organiserName`, available on the event). |
| **Request a refund** — "Only if eligible under the policy" | **Partly.** /refunds tells people to email support. There's no request flow. | For now → `/refunds` (or `mailto:` support with the order reference filled in). A request flow is NEW. |

Each row is a `<button>` (or a link, for a navigation). **Rows for features that aren't built are hidden**, not
disabled: principle 4.

### 5.6 Venue (dialog / sheet)

- Title: the venue name, 20/28 700.
- Then 4px, the **full address including the postcode** ("16 Catherine St, Coburg North VIC 3058"; 13/20
  `#5C5C5C`). It's `venueAddress` as the organiser entered it, plus the suburb and state when they're missing. The
  postcode shows only if the organiser typed it. Don't invent it.
- Rows, each 48 tall: **Apple Maps ↗**, **Google Maps ↗** (links, opening in a new tab, with "(opens in a new
  tab)" in sr-only text), **Copy address** (a button).
- Copy writes to the clipboard and announces "Address copied" through a polite status. If the clipboard is
  unavailable, the text is selected instead.
- The sheet adds a **Cancel** outline button.

### 5.7 Add to calendar (dialog / sheet; from the row on tablet and phone)

- Title "Add to calendar", then the sub "HERE & NOW · Sat 14 Nov, 5–9 PM" (13/20 `#5C5C5C`).
- Rows:
  - **Google Calendar** →
  - **Apple Calendar**, with the sub "Downloads an .ics file" →
  - **Outlook** →
- The same helpers as §5.2. The sheet adds **Cancel**.

### 5.8 Add to your phone's wallet (desktop and any device that can't add passes)

- **When it shows.** Pressing a wallet badge where the browser isn't iOS Safari or an Android Chrome-family
  browser, judged by user agent. That includes iPads: iPadOS has no Wallet for passes.
- **Layout.** A 480 dialog, `p-8`.
  - Title "Add to your phone’s wallet" 22/28 700, with ✕.
  - Then 8px, "Wallet passes live on your phone. Scan this with your phone camera to add it." (14/20 `#5C5C5C`).
  - Then 32px, a **QR** of 168 (≈ modules area) in its quiet zone, centred, **with the centre ü** (D1).
  - Then 24px, "Opens Apple Wallet on iPhone, Google Wallet on Android." (14/20 `#5C5C5C`, centred). 32px bottom
    padding.
- **The QR encodes** a NEW short route, `/api/orders/by-session/{orderId}/wallet?ticket={n}`. It picks Apple or
  Google by the phone's user agent and then behaves like today's per-provider routes.
  - The order id is the same capability as the page's own URL, so this exposes nothing new. A QR on a screen can
    still be photographed by someone nearby: the same risk as the ticket QR itself.
  - The decode suite covers this QR too (it's longer, so a higher version, still level H).
- **Alternative text.** "QR code that opens this ticket's wallet pass on your phone". Under it, the link "Or open
  the pass link here", for people who can't scan.

### 5.9 Order receipt (dialog / sheet)

- Title "Order #A90133C9" 20/28 700.
- Then 4px, "Placed 12 Nov 2026, 9:41 pm" (13/20 `#5C5C5C`). **Not "· Visa •••• 4417"** (D4).
- Then 16px, the lines:
  - "1 × Second release" with the amount **before fees**: `OrderPaymentLine` gives all-inclusive amounts, so the
    ex-fee amount needs B3.
  - "Booking fee" with `buyerFeeCents`.
  - "Support Sheltüh", when the buyer added it.
  - A 1px divider.
  - "**Total paid**" with **A$25.94** (700).
- **No GST or legal line** (D3).
- Then 16px, "**Download receipt (PDF)**": black, full width, 48 tall. **NEW** (§8, B7). Hide it until it's
  built.
- The sheet adds **Close**.

### 5.10 Ticket states (strips inside the compact card; full-screen variants)

| # | State | Card | Strip (white, `rounded-md`, `px-3`, 36–56 tall, Sans 14/20 600; link right, underlined) | Button | Data |
| --- | --- | --- | --- | --- | --- |
| 1 | Upcoming | orange | – | Show ticket → | **exists** |
| 2 | Waiting for {first name} to accept | orange | "Waiting for Sam to accept" · **Cancel** | Show ticket → (the QR still works until they accept) | **NEW: transfer** |
| 3 | Sent and accepted | grey | "This QR code no longer works" over "Sent to Sam · accepted 13 Nov" (≈ wording from `168`) | none | **NEW: transfer** |
| 4 | Checked in | orange | "✓ Checked in 7:42 pm" (black strip, white text ≈ `168`) | Show ticket → | **exists** (`CustomerTicket.checkedInAt`) |
| 5 | Event changed | orange | "Start time moved to 6 pm. Your ticket still works." · **Details** | Show ticket → | **NEW: change tracking** (B8) |
| 6 | Event cancelled | grey | "Event cancelled. A$25.94 refund on its way." (≈) | none | **NEW.** There's no "cancelled" event state (B9). |
| 7 | Refunded | grey | "Refunded A$25.94 on 15 Nov" | none | **Partly.** `status: refunded` exists; the **date** doesn't (B3). Until then: "Refunded A$25.94". |
| 8 | Event ended | grey | "Event ended" · **View receipt** | none | **exists** (end time), plus the receipt (§5.9) |

- **Past cards** (6, 7, 8 and 3) use `#F2F1EE` with a grayscale thumbnail, and sit under "Past · N".
- **Full screen after check-in** (`168`): the ticket with the "✓ Checked in" overlay (§5.1).
- **Strip links** ("Cancel", "Details", "View receipt") are separate targets, at least 44px tall: the strip's
  padding gives the height.

### 5.11 Send this ticket (dialog from 768 / sheet below; `160`, `163`)

- A 480 dialog, `p-8`.
  - Title "Send this ticket" 22/28 700, with ✕.
  - Then 8px, "Your friend gets their own QR code. This one stops working once they accept." (16/24 `#5C5C5C` at
    768; 14/20 desktop ≈).
  - Then 24px: **Their name**, a label (16/24 600), 8px, then an input (48 tall, 1.5px black, radius 8, `px-4`,
    16px text, placeholder "e.g. Sam Lee").
  - Then 16px: **Their email**, the same, with the placeholder "sam@email.com", `type="email"`,
    `autocomplete="off"`.
  - Then 24px: **Send ticket**, black, full width, 48 tall, radius 8, Sans 16 600 white.
- **The sheet** adds a **Cancel** outline button under it (`168`).
- **Sent.** A toast at the top: white, radius 8, a "✓" icon, "Sent to Sam. We'll email you when they accept."
  (≈). It's a `role="status"` region and auto-dismisses after 6s. **NEW** (transfer).
- **Errors.** Inline under a field: "Enter their name", "Enter a valid email", "That's your own email". Focus goes
  to the first invalid field.

### 5.12 Full-screen ticket (phones; `168`)

- **Opens from** "Show ticket →" as a full-screen dialog (`role="dialog"`, `aria-modal`).
- **Top bar** (56):
  - ✕ (left, 44 target, `aria-label="Close ticket"`)
  - "TICKET 1 OF 1" (centre, Mono 12/16 500 0.08em)
  - **Send** (right, text button, 44 target; hidden until transfer exists)
- **Body:** the full ticket card (§5.1, phone values ≈ the tablet ones), then the wallet badges.
- **Several tickets:** horizontal swipe (scroll-snap). Pager dots under the card (8px dots, orange for the current
  one), plus **Previous** and **Next** buttons (44 targets, visually quiet: chevrons at the card's sides), so
  screen-reader and switch users don't need a swipe gesture. The bar says "TICKET 2 OF 2". Each change is
  announced: a polite "Ticket 2 of 2".
- **Brightness.** Request a Screen Wake Lock while it's open, and release it on close or when the tab is hidden.
  The web can't raise brightness (D6), so the hint text stays on the card.
- **Escape and Back.** Close it. Focus returns to "Show ticket →".

### 5.13 Recipient: accept a ticket someone sent you (`168`; NEW, transfer)

- **Page** `/tickets/accept/{token}`:
  - An orange mono label "From Alex Chen" (D7).
  - Title "Alex sent you a ticket" (28/36 700).
  - The line "Accept to get your own QR code for the door." (16/24 `#5C5C5C`).
  - The compact card (no button).
  - **Accept ticket** (black, full width, 48), then **Decline** (outline, 48).
  - "Signed in as sam@email.com. Not you? Use another account." (13/20).
  - "Once you accept, Alex's copy stops working. If you decline, it goes back to Alex." (13/20 `#5C5C5C`)
    (≈ wording).
- **Accepting needs an account** with the invited email, verified. The signed-out view shows "Sign in to accept"
  and keeps `next`.

### 5.14 My tickets list (`162`, `168`)

- Heading "My tickets" (32/40 700), then 8px, "Tickets you've bought or been sent." (16/24 `#5C5C5C`).
- Then 48px, **"Upcoming · N"** (20/28 600), then 16px, the cards. Then 48px, **"Past · N"**, then the cards.
- Sort: upcoming soonest first; past most recent first.
- **"or been sent"** depends on transfer. Until transfer exists, the sub reads **"Tickets you've bought."**, an
  explicit interim copy change (Q4).
- **Empty:** "No tickets yet." with "Find an event" (outline button).
- **Loading:** three `EventCardPlaceholder`-style skeletons in the card shape.
- **Error:** a notice with "Try again".

## 6. Motion

- Dialogs fade and scale 0.98→1 over 150ms ease-out. Sheets slide up from 100% over 200ms ease-out. The scrim
  fades over 150ms. All of this sits behind `prefers-reduced-motion: no-preference`; with reduced motion,
  everything appears at once.
- The full-screen pager uses native `scroll-snap`. With reduced motion, Previous and Next jump without smooth
  scrolling.
- The toast slides down 8px and fades over 150ms. With reduced motion it only fades.

## 7. Ticket transfer ("Send ticket to a friend"): needs an architect plan and owner decisions

**It doesn't exist today.**
- Tickets carry a `code` (the QR is `SH1:` + code) and `checked_in_at`.
- Orders carry `buyer_email`, `buyer_email_key` and an immutable `buyer_name` (migration `20261122…`: it can only
  be cleared, for the organiser-notice reasons).
- There's no holder record per ticket, and no link from an account to an order (orders aren't keyed to a user;
  free claims only rate-limit by user).

**What a transfer needs** (for `software-architect`, then `backend-database-engineer`; security review required):
1. **A transfer record** per ticket: sender, recipient name and email, a hashed token, status (pending, accepted,
   declined, cancelled, expired) and timestamps. Behind RLS with no client grants; one atomic `private.*` function
   per step.
2. **Accepting** issues the ticket a **new code** (new QR) and **voids the old code atomically**. The door must
   reject the old code with a clear reason: a new `check_in_ticket` result such as `transferred`, shown to door
   staff as "This ticket was sent to someone else". Wallet passes for the old code must stop working: update the
   Apple pass through its web service if one exists (today's passes are static), and the Google object's state
   (`INACTIVE`).
3. **Holder records.** Who's Going opt-ins (`going`) belong to the sender's account. On accept, the sender's
   opt-in for that ticket is removed, and the recipient can opt in.
4. **Emails** (outbox): a "ticket sent to you" email to the recipient, with the accept link; an "accepted" or
   "declined" email to the sender; the recipient's own ticket email after accepting. Each one needs the Spam Act
   transactional framing (no marketing).
5. **Rules.** These are **owner decisions** (Q3):
   - Until when can a ticket be transferred: until the event starts, or until doors?
   - How many times per ticket (e.g. once)?
   - Free tickets only, or paid ones too?
   - Can the recipient pass it on again?
   - Is reselling for money banned? It must be: Sheltüh isn't a resale market, and organisers' terms apply.
   - How long does a pending transfer last (e.g. 72h, or until the event)?
   - Can the sender cancel any time before acceptance?
6. **Abuse limits.** Per-sender rate limits. A cap on pending transfers per account. No transfer of a
   checked-in, refunded or unlisted-event ticket. The recipient's email must be verified to accept. Block lists
   (`messages/blocked`) don't apply. Admin visibility (transfer log).
7. **Check-in implications.** The door app shows the new holder's name if names are introduced (B4). Check-in
   history stays with the ticket id, not the code.
8. **Organiser view.** The Orders view and CSV show the holder after a transfer. This changes the 12-month
   buyer-details notice: the **recipient** must be told the organiser sees their name and email.

**"Change ticket holder name"** (B4) is smaller but related. It needs a per-ticket `holder_name` (1–80 characters,
the same validation as `buyer_name`). It can't reuse `orders.buyer_name`, which is immutable and order-level. Its
visibility to the organiser needs the same notice decision.

## 8. Data: what exists vs what's new

| Need | Today | New work (id) |
| --- | --- | --- |
| A signed-in member's orders (the list, "← My tickets") | none: orders aren't keyed to accounts. `buyer_email_key` exists. | **B1**: list orders by the member's **verified** email key (plus transfers received). An authenticated route with ownership from the token (`requireCaller`). |
| A My ticket page for a signed-in member | `/checkout/success?session_id=` (capability) | **B1**: `/tickets/{orderId}` (or `/account/tickets/…`), owner-checked, with other users' orders returning 404. The capability page stays. |
| Event times, venue name, suburb, refund policy, totals, tickets, `checkedInAt`, wallet availability, masked email | in `CustomerOrder` | – |
| Full venue address, venue pin / place id (map, directions), organiser name | not in `CustomerOrder` (they're on the event) | **B2**: add `venueAddress`, `location` and `organiserName` to `CustomerOrder` (published events only, as the other event fields) |
| Purchase date and time, refund date, ex-fee line amounts | `createdAt` is on `OrderRecord`, not `CustomerOrder`. There's no refund timestamp. `OrderPaymentLine` is all-inclusive. | **B3**: `placedAt`, `refundedAt` (from the Stripe refund event / admin refund) and per-line ex-fee amounts |
| Ticket holder name | none per ticket; `orders.buyer_name` (immutable, order-level) | **B4**: per-ticket `holder_name`, plus a change endpoint |
| Resend confirmation (buyer) | admin only | **B5**: a self-serve, rate-limited resend |
| Card brand and last 4 | not stored | **B6**: store the PaymentMethod's `card.brand` and `last4` from the Stripe webhook (no other card data). A privacy-policy line. |
| PDF receipt | none (no PDF library; `@playwright/test` is dev-only) | **B7**: prefer an **HTML receipt page with print CSS** ("Download receipt" → a printable page, the browser's "Save as PDF") over adding a PDF dependency. A true PDF needs a dependency decision (e.g. `pdf-lib`). |
| Event change notices | no tracking of time/venue changes after publish. There are organiser broadcasts (holder messages) and the admin edit log. | **B8**: record material changes (start, end, venue) after the first sale, with the old and new values, plus a holder notice. |
| Event cancelled | no cancelled state (unpublish plus refunds are manual) | **B9**: a cancellation state, plus refund automation |
| Transfer | none | **B10**: §7 |
| Wallet auto-route for the desktop QR | per-provider routes exist | **B11**: one route that picks the provider by user agent |

## 9. Increments (each ships alone; UI first where data exists)

**M1. Restyle the existing ticket page** (`/checkout/success`; frontend only; data that exists today)
- The full ticket card (§5.1) and the official wallet badges (D2, if the assets are in).
- The right column with **Add to calendar** and the Ticket details rows TICKET, ORDER and TOTAL PAID. PURCHASED
  is hidden until B3.
- "View event page".
- **Getting there** with the venue name and suburb only. The map placeholder and directions links wait for B2.
- Phones get the compact card and the full-screen ticket, with Wake Lock and the pager with buttons.
- The checked-in overlay.
- The calendar dialog/sheet.

*Accept:*
- Renders at 1440, 768 and 390 compared side by side with `157`, `166` and `167`, with a pixel diff where
  feasible (Playwright, fixture order, the photo and QR masked; ≤2% differing pixels outside the masks).
- Every QR passes the decode suite at its tile.
- Dialogs at ≥768 and sheets below. Focus is trapped. Escape closes and returns focus. axe is clean.
- Demo mode shows sample tickets.

**M2. Signed-in list and page** (B1, B2, B3): `/tickets`, `/tickets/{id}`, and the "My tickets" links in the
avatar menu and drawer (`navigation-search.md`).
- *Accept:* a member sees only their own orders (another member's id → 404). Upcoming and Past are split
  correctly. States 1, 4, 7 and 8 render from real data.

**M3. Manage order: the rows that exist**
- Resend (B5), Request a refund (→ /refunds), the receipt dialog without card details or legal line (D3, D4).
- Hidden rows: transfer, holder name, contact organiser.

**M4. Holder name** (B4).

**M5. Transfer** (B10; architect plan first, then the owner's Q3 answers; security review)
- Send, the recipient accept page, states 2 and 3, the toast, the door's `transferred` result, and the wallet
  invalidation.

**M6. Event change notices and cancellation** (B8, B9): states 5 and 6.

**M7. Receipt download** (B6, B7) and **Contact organiser** (Q5).

Each increment updates the existing `CheckoutConfirmation` / `TicketStub` tests rather than deleting them.

## 10. Questions

**For the owner:**
1. **Q1: The receipt's GST line and legal name.** Is Sheltüh registered for GST? A receipt may only say "Includes
   GST of …" if it is. What legal name and ABN should receipts print? *Recommend:* leave both out (D3) until
   you confirm. Use the same answer for the email footer.
2. **Q2: Small orange text** (D7). Use `#D03E00` (4.8:1) for "Order … Confirmed" and "From …"? *Recommend:* yes,
   the same as the email's P1.
3. **Q3: Transfer rules.**
   - Allowed until the event starts?
   - Once per ticket?
   - Free and paid?
   - Can the recipient pass it on again?
   - How long does a pending transfer last?
   *Recommend:* paid and free; until 2 hours before start; once; no re-sending; pending for 72 hours or until
   that cut-off; no money changes hands through Sheltüh.
4. **Q4: Interim copy.** "Tickets you've bought." until transfer ships, instead of "…or been sent." *Recommend:*
   yes.
5. **Q5: Contact organiser.** A `mailto:` to a contact address organisers add (new field), or a message thread on
   Sheltüh? *Recommend:* `mailto:` first. A thread is larger and needs moderation.

**For Latte:**
1. Confirm the mono facts and capitals on this page, which override the site's 13 Nov rule.
2. The phone page margin: it measures **24**, but the footer and the site use 16. Which is intended?
3. Is there a list layout from 1024 (assumed: three columns)?
4. Exact copy for the small `168` frames: states 3 and 6, the recipient notes, the sent toast and the full-screen
   caption.
5. Confirm the button radius (6 measured) and the tablet QR size.
