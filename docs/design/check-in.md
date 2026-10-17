# Door check-in and the QR ticket: design spec

Status: spec, not built · Owner: ui-design-director · Scope: (A) the organiser's door scanner at
`/dashboard/[eventId]/check-in`, used on a phone at a loud, dark venue entrance; (B) the QR code on
`/checkout/success`, which replaces the Code 128 barcode in `components/tickets/TicketStub.tsx`. Phones from 320px,
plus tablet.

**Code read:** `app/globals.css`, `app/layout.tsx`, `docs/design-system.md`, `docs/design/*.md`, `docs/pwa.md`,
`docs/architecture.md` ("Check-in"), `docs/REMEDIATION_PLAN.md` (Phase 2), `lib/api/check-ins.ts`,
`lib/api/types.ts` (check-in types), `lib/ticket-code.ts`, `lib/format.ts`, `lib/pwa/theme.ts`, `next.config.ts`,
`components/tickets/{TicketStub,LinearBarcode,UBarcode}.tsx`, `tests/TicketStub.test.tsx`,
`components/CheckoutConfirmation.tsx`, `app/checkout/success/page.tsx`, `app/dashboard/[eventId]/page.tsx`,
`components/dashboard/DashboardContent.tsx`, `components/analytics/{AnalyticsGate,StatGrid,TicketTypeTable,shared}.tsx`,
`components/ui/{Button,Field,Section}.tsx`, `components/messages/ReportDialog.tsx`, `components/Nav.tsx`.

**Facts that shape this spec:**
- A code is `XXXX-XXXX` from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1 or I). The QR carries `SH1:XXXX-XXXX`.
  `parseTicketCode` needs the hyphen, so manual entry has to normalise before sending (§5.A6).
- `checkInTicket` resolves for every ticket outcome. Any thrown error means **nothing was marked**. Retrying
  with the same `requestId` returns the original result, and `signal` lets the client time out.
- Results never contain buyer identity. The UI shows ticket type, "Ticket n of N", the last four characters of the
  code and times, and nothing else.
- Today the whole app is paper (`#f3f0e8`). There is no dark scope and no green or amber token. The Nav is sticky
  everywhere except message threads (`inThread` → `relative`).
- `/checkout/success` is network-only. The service worker never caches pages, so the ticket page needs a connection
  (`docs/pwa.md`).
- There's no app-wide CSP (only `/sw.js` has one), so a self-hosted WASM scanner needs no header change today.
- At 320px, the stub's content box is 222px wide: page `px-4`, panel `p-4`, stub `border p-4`.

---

## 1. Principles

1. **One glance, three answers.** Every result is one of three things: *let in*, *don't let in* or *not verified*.
   Each is said four ways: a headline word, a distinct icon, a panel treatment that differs in **lightness** as well
   as hue (bright fill, dark fill, black with a striped frame), and vibration or sound. Colour is never the only
   signal, and lightness separates "let in" from "don't" even under red-green colour blindness or in a dim room.
2. **Never imply admission without the server.** Only an `admitted` response turns the panel green. Errors,
   timeouts and offline states always say "Not verified. Don't let in yet." and show Retry.
3. **Dark room, dark screen.** The door surface is ink, so the phone doesn't light up the staffer's face or wreck
   their night vision. Bright colour appears only as a result, for a few seconds.
4. **The camera is a convenience, typing is the guarantee.** Manual entry is always on the page and works with the
   camera off, denied or unsupported.
5. **Thumb-sized and calm.** Targets are 44px or more (48px for primary ones). Nothing flashes or slides, and results
   change no faster than once a second. Focus stays where the staffer left it.
6. **The ticket is a plate, not a picture.** The QR is pure black on pure white with its quiet zone, in every theme
   and in print, with the human-readable code directly underneath.

---

## 2. Tokens

### 2.1 New tokens (`app/globals.css`)

There are two additions: three door fill pairs, and one scoped re-skin of the existing semantic tokens. No new
fonts, radii or spacing steps.

Add to `:root`, after the `--cat-*` block:

```css
  /* Door check-in only (components/check-in/, docs/design/check-in.md). Each fill has its text pair.
     Never used for decoration; colour is never the only signal (icon + words + panel shape). */
  --door-admit: #3ddc84;            /* "Let in" panel fill, admitted icon on ink */
  --door-admit-foreground: #0b0b0b;
  --door-refuse: #b3261e;           /* "Don't let in" panel fill (same value as paper-scope --danger) */
  --door-refuse-foreground: #f3f0e8;
  --door-hold: #ffb020;             /* "Not verified": frame, hazard stripes, icon, headline; offline banner fill */
  --door-hold-foreground: #0b0b0b;
```

Add the mappings to `@theme inline`: `--color-door-admit`, `--color-door-admit-foreground`, `--color-door-refuse`,
`--color-door-refuse-foreground`, `--color-door-hold` and `--color-door-hold-foreground`, each `var(--…)`.

Add the door scope after the `:root` media query:

```css
/* Door check-in: an ink surface for dark venues. Every shared component re-skins through these. */
[data-door] {
  color-scheme: dark;
  --background: #0b0b0b;
  --surface: #1a1a1a;
  --surface-border: #3a3833;
  --foreground: #f3f0e8;
  --muted: #a39e93;
  --accent: #f3f0e8;
  --accent-strong: #d3cec1;
  --accent-foreground: #0b0b0b;
  --danger: #ff6b5e;
  --danger-foreground: #0b0b0b;
  background: var(--background);
  color: var(--foreground);
}
```

The swap works because `@theme inline` emits `var(--background)` and friends at the point of use. `.btn-solid` and
`.btn-outline`, `Field`, `Notice`, `EmptyState`, the base input rule, the `:focus-visible` ring and
`NotApprovedOrganiser` all turn light-on-ink with no component changes. Paper-scope `--muted` (#6b675e) is only
3.5:1 on ink, which is why the door scope needs its own `--muted`.

Add a guard test like `tests/phone-home-tokens.test.ts`: `door-` utility classes and `data-door` may appear only in
`components/check-in/` and the check-in route.

### 2.2 Contrast (computed with WCAG relative luminance)

| Text or mark | On | Ratio | Use |
| --- | --- | --- | --- |
| `foreground` #f3f0e8 | door `background` #0b0b0b | 17.3:1 | All door text, reticle, counters |
| `foreground` | door `surface` #1a1a1a | 15.3:1 | Idle viewfinder, `NotApprovedOrganiser` |
| door `muted` #a39e93 | #0b0b0b / #1a1a1a | 7.4:1 / 6.5:1 | Labels, hints, times |
| door `danger` #ff6b5e | #0b0b0b / #1a1a1a | 7.0:1 / 6.2:1 | Field errors, refused icon in the list, Undo pill |
| `accent-foreground` #0b0b0b | `accent` #f3f0e8 / hover #d3cec1 | 17.3:1 / 12.5:1 | Solid pills (Check, Start camera, Retry) |
| `door-admit-foreground` #0b0b0b | `door-admit` #3ddc84 | 11.0:1 | Let-in panel text, icon and focus ring |
| `door-admit` | #0b0b0b | 11.0:1 | Checked-in icon in the list |
| `door-refuse-foreground` #f3f0e8 | `door-refuse` #b3261e | 5.7:1 | Don't-let-in panel text, icon and focus ring |
| `door-refuse` panel edge | #0b0b0b | 3.0:1 | Non-text boundary (not relied on; the panel has words) |
| `door-hold` #ffb020 | #0b0b0b | 10.8:1 | Not-verified headline, icon, frame and stripes |
| `door-hold-foreground` #0b0b0b | `door-hold` | 10.8:1 | Offline banner text |
| `surface-border` #3a3833 | #0b0b0b | 1.7:1 | Hairlines and bar tracks only (decorative) |
| QR #000000 | #ffffff | 21:1 | QR modules |
| `foreground` #0b0b0b | paper `surface` #eae6db | 15.8:1 | Ticket code text on the stub |
| paper `muted` #6b675e | paper `surface` | 4.5:1 | Brightness hint on the stub (passes AA, just) |

**Lightness separation:** the let-in fill has relative luminance 0.54 and the don't-let-in fill 0.11. They stay
clearly different for protanopes and deuteranopes. Not verified isn't a fill at all: it's black with an amber frame
and stripes. Let-in and the amber are close in lightness, so the **shape** (solid fill versus striped frame) and
the icon carry that difference.

### 2.3 Type (door scope)

| Role | Family | Size / line-height | Tracking | Case | Weight | Tailwind |
| --- | --- | --- | --- | --- | --- | --- |
| Event title (h1) | Bricolage | 20/20 phones, 36/34 `md+` | -0.01em | upper | 800 | `font-heading text-xl leading-5 md:text-4xl md:leading-[2.125rem] line-clamp-1 md:line-clamp-2` |
| Eyebrow ("Door check-in", labels) | Inter | 11/16 | 0.14em | upper | 600 | `eyebrow text-muted` |
| Counter numeral | Bricolage | 40/40 phones, 60/60 `md+` | -0.01em | — | 800 | `font-heading text-[2.5rem] leading-10 md:text-6xl md:leading-none tabular-nums` (the 2.5rem value is `StatGrid`'s) |
| Counter label | Inter | 14/20 | 0 | sentence | 400 | `text-sm`, secondary `text-sm text-muted` |
| Result headline | Bricolage | 40/38 phones, 60/56 `sm+` | -0.01em | upper | 800 | `font-heading text-[2.5rem] leading-[2.375rem] sm:text-6xl sm:leading-[3.5rem]` |
| Result reason | Inter | 20/28 | 0 | sentence | 600 | `text-xl font-semibold` |
| Result detail | Inter | 16/24 | 0 | sentence | 400 (ticket type 600) | `text-base` |
| Manual input | mono | 16/24 (no iOS zoom) | 0.05em | upper | 400 | `fieldClass font-mono uppercase tracking-wider` |
| Recent row label | Inter | 14/20 | 0 | sentence | 600 | `text-sm font-semibold` |
| Recent row detail and time | Inter | 14/20; 12/16 | 0 | sentence | 400 | `text-sm text-muted`; `text-xs text-muted tabular-nums` |
| Section h2 | Bricolage | 24/23 | -0.01em | upper | 800 | `Panel` title (`display-md !text-2xl`) |

### 2.4 Spacing, radii, borders, icons

- **Spacing:** only 4, 8, 12, 16, 20, 24, 32 and 48 px (`1, 2, 3, 4, 5, 6, 8, 12`).
- **Radii:** 0 everywhere except `.btn` pills. The viewfinder, panels, dialog and QR plate are square.
- **Borders:** 1px `surface-border` hairlines between list rows. Sections use `border-t border-foreground`. The
  not-verified panel uses a 2px `door-hold` frame.
- **Icons:** one inline-SVG set in `components/check-in/DoorIcon.tsx`, with `viewBox="0 0 24 24"`, `fill="none"`,
  `stroke="currentColor"`, `stroke-width="3"`, square caps and miter joins, and `aria-hidden="true"`. Sizes are
  48px (`size-12`) in result panels and 20px (`size-5`) in lists and banners. No emoji.
  - `check`: `M4 12.5 9.5 18 20 6.5`
  - `cross`: `M6 6l12 12M18 6 6 18`
  - `alert`: triangle `M12 3 22.5 21h-21z` (stroke-width 2.5), line `M12 9.5v5`, dot `circle cx=12 cy=17.75 r=1.25`
    filled
  - `undo`: `M9 15 4 10l5-5` plus `M4 10h10.5a5.5 5.5 0 0 1 0 11H11`

---

## 3. Grid and layout

### 3.1 Route shell

- **`app/dashboard/[eventId]/check-in/page.tsx`:** a one-liner over `components/check-in/CheckInPage.tsx` with
  `metadata.title = "Door check-in — Sheltüh"` and `export const viewport = { themeColor: DOOR_THEME_COLOR }`. Add
  `DOOR_THEME_COLOR = "#0b0b0b"` to `lib/pwa/theme.ts`, so the status bar is ink, not paper.
- **Wrapper:** `<div data-door className="flex min-h-svh flex-col">` fills `main`. The paper Footer follows below
  the fold, which is fine.
- **Nav:** on this route, the Nav is `relative` at every width instead of `sticky`. Use the same mechanism as
  `inThread`, matched with `/^\/dashboard\/[^/]+\/check-in$/`. That way the paper header scrolls away and doesn't
  sit lit above the scanner. On **Start camera**, scroll the door wrapper's top to the viewport top: `window.scrollTo`
  to its `offsetTop`, `behavior: "auto"` (instant). Don't use `scrollIntoView`, because `scroll-padding-top` would
  leave a 64px gap.

### 3.2 Phones, 320–639px (one column, `px-4`, `pt-2 pb-12`)

The order is the reading and focus order:

1. Offline banner, only when offline (sticky `top-0 z-10`).
2. Header row (`flex min-h-11 items-center justify-between`): back link on the left, "Door check-in" eyebrow on the
   right.
3. Event title, h1, one line truncated (`mt-1`).
4. Counters (`mt-3`): the numeral row and the progress bar.
5. Scanner slot (`mt-4`): the viewfinder, **4:3**, full content width, `max-h-[60svh]`. Result panels and camera
   states fill the same slot (§5.A3).
6. Manual entry (`mt-4`).
7. Sound and vibrate toggles (`mt-4`).
8. "By ticket type" (`mt-8`, a `<details>`).
9. Recent scans (`mt-8`).
10. "How check-in works" (`mt-8`, a `<details>`).

**Budget with the Nav scrolled away and the camera live:**

| Width | Content width | Viewfinder | Header + counters | Up to the bottom of manual entry |
| --- | --- | --- | --- | --- |
| 320 (568 tall) | 288 | 288×216 | ~140 | ~446px. Fits in Safari's ~460px visible area |
| 375 (667) | 343 | 343×257 | ~140 | ~487px. Fits in ~553px |
| 430 (932) | 398 | 398×298 | ~140 | ~528px. Fits easily |

A refusal panel can be taller than the 4:3 slot at 320 and 375 (§5.A4). The slot grows and pushes manual entry
down while it shows. That's accepted, because the staffer is dealing with the person in front of them.

### 3.3 640–767px (one column, centred `max-w-xl`, `px-6`)

Same order as phones. The viewfinder stays 4:3 (528×396).

### 3.4 Tablet, 768px and up (`max-w-6xl mx-auto px-8 pt-4 pb-16`)

- The header (rows 2–3) spans the full width. Below it, `md:grid md:grid-cols-12 md:gap-8`.
- **Left, `md:col-span-7`:** scanner slot (**1:1**, `md:aspect-square md:max-h-[60svh]`), manual entry, toggles,
  then "How check-in works".
- **Right, `md:col-span-5`:** counters (60px numeral), "By ticket type" as an always-open list (no `<details>`),
  then Recent scans. At 768 the columns are about 380 and 260 wide. At 1024 and up they're about 520 and 360.
- Landscape phones use the phone layout. The `max-h-[60svh]` cap keeps manual entry reachable.

---

## 4. Imagery

- **Camera feed:** `<video playsInline muted autoPlay>` with `object-cover` in the scanner slot. The reticle is a
  centred square whose side is 70% of the slot's shorter side, drawn as four L-shaped corners: 24px arms, 4px
  `foreground` stroke and a 1px `background` outer edge (SVG `paint-order="stroke"`), so it reads over bright and
  dark video. There's no scan line and no animation. **No text sits on the video.** Controls that overlap it have
  opaque `bg-background`.
- **Decode region:** only codes whose bounding-box centre falls inside the reticle count. A poster on the wall at
  the edge of the frame is ignored.
- **No event art** on the scanner.
- **QR plate on the ticket:** see §5.B.

---

## 5. Components

### Part A: the scanner (`components/check-in/`, all client)

#### 5.A1 `CheckInPage.tsx`: gate, data and orchestration

**Gate**, in the door scope, using the shared states (they re-skin):

| Condition | What renders | Copy |
| --- | --- | --- |
| `!auth.configured` (demo mode) | `Notice tone="danger" role="alert"` | "Accounts aren't configured in this environment yet. Door check-in needs a live Sheltüh account." |
| Auth or organiser loading | `p.text-sm.text-muted` | "Loading…" |
| Signed out | `EmptyState headingLevel={1}` + `ButtonLink size="lg"` to `withNext("/login", "/dashboard/{id}/check-in")` | Title "Sign in to check people in". Button "Sign in" |
| Organiser error | `p[role=alert].text-sm.text-danger` | the error |
| Not an approved organiser, or API 403 | `NotApprovedOrganiser` with new optional prop `need` | "You need an approved organiser application before you can check people in at the door." Button as today |
| Summary loading (first time) | Header skeleton: title "Loading check-in…" in muted, counters "—" | — |
| Summary 404 | `EmptyState headingLevel={1}` + `ButtonLink variant="outline" size="lg" href="/dashboard"` | Title "Event not found". Body "It may have been deleted, or it belongs to another organiser account. Only the organiser who owns an event can check people in." Button "Back to your events" |
| Summary 401 | As signed out | — |
| Summary other error (first load) | `EmptyState headingLevel={1}` + `Button size="lg"` | Title "Couldn't load check-in". Body "Check your connection, then try again." Button "Try again" |

`NotApprovedOrganiser` change: add `need?: string`, default "see analytics". The existing callers don't change.

**Data rules:**
- Refresh the summary after every result and every undo (debounced 1000ms), and every 15s while
  `document.visibilityState === "visible"`.
- On `admitted`, increment `checkedIn` locally at once, then reconcile with the refresh.
- If a refresh fails after the first success, keep the last numbers. Show `p.text-xs.text-muted` under the counters:
  "Counts last updated 8:42 pm. Retrying…".

#### 5.A2 Header and counters (`CheckInHeader.tsx`)

- **Row:** on the left, the back link `backLinkClass` "← Your events" to `/dashboard`. On the right, the eyebrow
  "Door check-in". On `md+`, the eyebrow also shows the date as "Door check-in · Sat 18 Oct, 7:00 pm"
  (`formatEventDateTimeRange(startsAt)`).
- **h1:** `summary.event.title`, styled as §2.3.
- **Counters:** `section aria-labelledby` with a visually hidden h2 "Count".
  - Phones: `flex items-end gap-3`. The numeral `checkedIn`, then a stack: "checked in" (`text-sm`) and "of 240
    sold · 112 to come" (`text-sm text-muted`). "To come" is `max(0, ticketsSold − checkedIn)`. On the right
    (`ml-auto`): eyebrow "Capacity 300".
  - Bar `mt-2 h-1 w-full bg-surface-border`, with the inner fill `bg-foreground` at
    `min(100, checkedIn / ticketsSold × 100)%` (0 when nothing has sold). `aria-hidden` (the words carry it).
  - Counts use `formatCount` (never abbreviated).
  - **No sales:** "0 checked in · of 0 sold", then `text-sm text-muted`: "No tickets have been sold for this event
    yet."
- **Polite announcement:** a visually hidden `aria-live="polite" aria-atomic="true"` region. It's set to "129
  checked in of 240 sold." only when `checkedIn` changes, debounced 1500ms, and never on page load.

#### 5.A3 Scanner slot (`Scanner.tsx`)

**Structure:** `div.relative.grid` with one grid cell. Every layer sits in it with `[grid-area:1/1]`:
- the video box (`aspect-[4/3] md:aspect-square max-h-[60svh] w-full bg-surface overflow-hidden`)
- the state layer (idle, errors, Checking)
- the result panel

The cell is as tall as the taller of the video box and the panel, so long copy grows the slot instead of
clipping.

**Camera:**
- `getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })`. Start only on a tap.
- Detection uses native `BarcodeDetector({ formats: ["qr_code"] })`, falling back to the `barcode-detector`
  ZXing-WASM polyfill. Load the polyfill with a dynamic `import()` on Start, on this page only.
- Decode at about 8 frames per second.
- Keep the screen awake with `navigator.wakeLock.request("screen")` while live. Release it on stop or when the page
  is hidden, and fail silently.
- When the page is hidden, stop the stream and go to Paused.

**States.** Each one fills the slot: `bg-surface p-4 sm:p-6 flex flex-col justify-center gap-3`, text left-aligned
and `max-w-sm`.

| State | Anatomy | Copy (exact) | Focus |
| --- | --- | --- | --- |
| Idle (before first tap) | h2 `text-xl font-semibold`, `p.text-sm.text-muted`, `Button size="lg" variant="solid"` | h2 "Scan tickets with your camera". Body "Your browser will ask to use the camera. Nothing is recorded: only the ticket code is sent to check it." Button "Start camera" | — |
| Starting | `p.text-base` | "Starting camera…" | Stays on the busy button (`busy`) |
| Live | Video, reticle, controls overlay | Visually hidden status: "Camera on. Hold the ticket's QR code inside the frame." | Moves to **Stop camera** (it replaces Start) |
| Paused (page was hidden) | As Idle | h2 "Camera paused". Body "The camera stops when you leave this page." Button "Resume camera" | — |
| Stopped by the user | As Idle | h2 "Camera off". Body "You can still type codes below." Button "Start camera" | Moves to **Start camera** |
| Permission denied (`NotAllowedError`) | h2 + `alert` icon (20px, `text-danger`) + body + list + button | h2 "Camera access is blocked". Body "Allow the camera for this site, then tap Try again. Until then, type codes below." List (`text-sm`, ordered): "iPhone: tap **aA** in the address bar, then Website Settings › Camera › Allow." / "Android (Chrome): tap the icon left of the address, then Permissions › Camera › Allow." Button "Try again" | Moves to the h2 (`tabIndex={-1}`) |
| Insecure context (`!isSecureContext`) | h2 + body, no button | h2 "The camera needs a secure connection". Body "Browsers only allow the camera on addresses starting with https://. Open this page that way, or type codes below." | — |
| Unsupported (no `mediaDevices.getUserMedia`, typical of in-app browsers) | h2 + body | h2 "This browser can't use the camera here". Body "Open this page in Safari (iPhone) or Chrome (Android), or type codes below." | — |
| No camera (`NotFoundError`, `OverconstrainedError`) | h2 + body | h2 "No camera found". Body "Type codes below." | — |
| Camera busy (`NotReadableError`) | h2 + body + button | h2 "The camera is in use". Body "Close any other app using the camera, then try again." Button "Try again" | Moves to the h2 |
| Scanner failed to load (polyfill import or WASM error) | h2 + body + button | h2 "The scanner couldn't load". Body "Check your connection and try again, or type codes below." Button "Try again" | Moves to the h2 |

The Insecure and Unsupported checks run on mount, so those states replace Idle and Start is never offered.

**Live controls:** `absolute bottom-3 right-3 flex gap-2`, each `Button size="sm" variant="outline"` with
`min-h-11 bg-background`.
- **Torch:** shown only when `track.getCapabilities().torch` is true. It's a toggle with a fixed name and
  `aria-pressed`. When on, it gets `btn-solid` styling and a leading 20px `check` icon. Hint in "How check-in works":
  torch is for paper tickets; turn it off for phone screens (glare).
- **Stop camera.**

**Checking:** once a code is accepted, the frame stays live and decoding pauses. If no response has arrived after
250ms, the state layer shows `bg-background p-4`: "Checking…" (`font-heading text-2xl`) and "Code ends 2HXD"
(`text-base text-muted`). It's static text with no spinner. The 250ms delay stops fast responses flickering.
**Timeout:** abort the request through `signal` at 8000ms. That's a Not verified result (§5.A4).

#### 5.A4 Result panel (`ResultPanel.tsx`)

Fills the slot (`[grid-area:1/1] p-4 sm:p-6 flex flex-col gap-2`). It isn't focused and isn't a live region itself
(see §5.A8). Each panel resets the tokens locally so text, focus ring and outline pills follow the fill:

| Kind | Classes |
| --- | --- |
| Let in | `[--background:var(--door-admit)] [--foreground:var(--door-admit-foreground)] bg-background text-foreground` |
| Don't let in | `[--background:var(--door-refuse)] [--foreground:var(--door-refuse-foreground)] bg-background text-foreground` |
| Not verified | `bg-background text-foreground border-2 border-door-hold`, plus 8px hazard bands at the top and bottom inside the frame: `h-2 bg-[repeating-linear-gradient(-45deg,var(--door-hold)_0_8px,transparent_8px_16px)]`. This is a hard-edged caution pattern, not a decorative gradient. Headline and icon `text-door-hold` |

**Anatomy** (top to bottom):
1. Row `flex items-start gap-3`: icon `size-12 shrink-0`, then the headline (wraps onto two lines when needed).
2. Reason line.
3. Detail lines.
4. Actions `mt-auto pt-2 flex flex-col gap-2 sm:flex-row`, each pill `size="lg" w-full sm:w-auto`.

Below, "2HXD" stands for `codeLast4`, "General admission" for `ticketTypeName`, "2 of 3" for
`ticketNumber`/`ticketCount`, and times use `formatEventTime` ("8:42 pm") plus a relative part: "just now" under
60s, "14 min ago", "1 hr 5 min ago". After 24h it's `formatDayTime`.

| Outcome | Icon | Headline | Reason | Details | Actions |
| --- | --- | --- | --- | --- | --- |
| `admitted` | check | LET IN | Checked in | **General admission** / Ticket 2 of 3 · Code ends 2HXD | none (auto-returns) |
| `already_checked_in` | cross | DON'T LET IN | Already checked in | **General admission** / Ticket 2 of 3 · Code ends 2HXD / First checked in 8:42 pm (14 min ago). If the first check-in was this device's own scan in the last 60s, add: "Checked in on this device 4 sec ago." | "Scan next" (outline) |
| `not_admissible` | cross | DON'T LET IN | Ticket void | **General admission** / Ticket 2 of 3 · Code ends 2HXD / Its order was refunded or isn't paid. | "Scan next" |
| `other_event` | cross | DON'T LET IN | Wrong event | This ticket is for **{otherEventTitle}**. / General admission · Ticket 2 of 3 · Code ends 2HXD | "Scan next" |
| `invalid` (server) | cross | DON'T LET IN | Not a valid ticket | This code isn't a ticket for any of your events. | "Scan next" |
| Decoded QR that isn't a Sheltüh code (local, no request; see §7 proposal 1) | cross | DON'T LET IN | Not a Sheltüh ticket | This QR code isn't a Sheltüh ticket. Ask for the ticket email or the Sheltüh confirmation page. | "Scan next" |
| Network failure, offline, timeout or abort (`ApiError` 0) | alert | NOT VERIFIED | Don't let in yet | Couldn't reach Sheltüh. Nothing was marked. Retry when you have signal. | "Retry" (solid), "Scan another" (outline) |
| 429 | alert | NOT VERIFIED | Don't let in yet | Too many scans in the last few minutes. Nothing was marked. Wait a few seconds, then retry. | "Retry", "Scan another" |
| 5xx | alert | NOT VERIFIED | Don't let in yet | Sheltüh had a problem. Nothing was marked. Retry in a moment. | "Retry", "Scan another" |
| 401 | alert | NOT VERIFIED | Don't let in yet | You've been signed out. Nothing was marked. Sign in again, then retry. | `ButtonLink` "Sign in" (to `withNext` back here), "Scan another" |
| 403 or 404 | alert | NOT VERIFIED | Don't let in yet | This account can't check people in for this event. Nothing was marked. | `ButtonLink` "Back to your events", "Scan another" |
| 400 or 413 | alert | NOT VERIFIED | Don't let in yet | This scan couldn't be sent. Nothing was marked. Type the code below instead. | "Scan another" |

**Retry:** reuse the scan's `requestId`. While retrying, the button is `busy` with the label "Retrying…" and the
panel stays. A retry that returns `admitted` shows the normal Let-in panel, which is correct for a lost response.

**Hold, replace and return** (`DOOR_TIMING` constants, one place):

| Panel | Minimum hold (new scans ignored) | Returns to the viewfinder | Replaced by |
| --- | --- | --- | --- |
| Let in | 1000ms | after 2500ms | A different code decoded after the minimum hold, a manual submit, or "Scan next" (none shown here) |
| Don't let in | 2000ms | after 10000ms, or on "Scan next" | A different code after the minimum hold, or a manual submit |
| Not verified | until resolved | Never by itself | "Retry", "Scan another", or a manual submit. Camera decodes are **ignored** while it shows, so the unresolved person isn't lost |

- **Same code:** any decode of the same canonical code within 3000ms of its result appearing is ignored, with no
  request, sound or vibration. After 3000ms it counts as a new scan with a new `requestId`. That gives "Already
  checked in", annotated "on this device" as above.
- **One request at a time:** while a request is in flight, every decode is ignored and the manual Check button is
  `busy`.
- **Timers pause** while keyboard focus or a pointer is inside the panel.
- **Between results:** when a new scan is accepted, the current panel is removed at once. The live frame (or the
  Checking layer) shows before the next result. Two consecutive greens are therefore always separated, and with the
  minimum holds no panel can change more than once a second (WCAG 2.3.1: under 3 flashes a second).
- **Auto-dismiss is safe:** WCAG 2.2.1 is respected because every server result is also kept in Recent scans.

**Vibration**, where `navigator.vibrate` exists (Android; iOS Safari has none):

| Result | Pattern |
| --- | --- |
| Let in | `[80]` |
| Don't let in | `[120, 80, 120, 80, 120]` |
| Not verified | `[300, 150, 300]` |

**Sound** (Web Audio, unlocked by the Start-camera or Check tap; square wave, gain 0.2):

| Result | Tone |
| --- | --- |
| Let in | 1046 Hz, 120ms |
| Don't let in | 330 Hz, 180ms, twice, 80ms apart |
| Not verified | 660 Hz, 90ms, three times, 60ms apart |

Square waves cut through crowd noise better than sine.

**Forced colours** (Windows High Contrast): fills drop out. Add `forced-colors:border-4 forced-colors:border-[CanvasText]`
to all three panels. The icon and words still carry the meaning.

#### 5.A5 Offline banner (`OfflineBanner.tsx`)

- Shown when `navigator.onLine === false` or after an `offline` event. Hidden on `online`.
- Anatomy: `role="status"`, `sticky top-0 z-10 bg-door-hold text-door-hold-foreground px-4 py-3 min-h-11 flex
  items-center gap-2 text-sm font-semibold`, with a 20px `alert` icon.
- Copy: "You're offline. Scans can't be checked until you reconnect."
- On reconnect, the banner goes and the polite region says "Back online." The summary refreshes.
- Scans are still attempted while the banner shows (`onLine` can be wrong). They fail fast into Not verified.

#### 5.A6 Manual entry (`ManualEntry.tsx`)

**Anatomy:** a `<form noValidate>` using `Field`:
- Label "Type a code". `htmlFor="door-code"`.
- Row `flex gap-2`:
  - Input `id="door-code"` with `fieldClass font-mono uppercase tracking-wider flex-1 min-w-0`, `inputMode="text"`,
    `autoCapitalize="characters"`, `autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}`,
    `enterKeyHint="go"`, `maxLength={20}` and placeholder "7KQM-2HXD".
  - `Button type="submit" size="lg" variant="solid"` "Check".
- Hint: "Like 7KQM-2HXD. Codes never contain O, 0, I or 1."

**Normalising on submit:** trim, uppercase, strip a leading `SH1:`, remove spaces and hyphens. If 8 characters from
the alphabet remain, send `XXXX-XXXX`. Otherwise don't send. Show the error `p.text-sm.text-danger` "That's not a
ticket code. Codes have 8 letters and numbers, like 7KQM-2HXD.", set `aria-invalid` and `aria-describedby`, and keep
focus in the input.

**States:**

| State | Behaviour |
| --- | --- |
| Busy | Button "Checking…" (`busy`). The input stays editable |
| Result other than Not verified | Clear the input. Focus stays in it for the next code |
| Not verified | Keep the code. Submitting the same code again while its Not-verified panel shows counts as **Retry** (same `requestId`) |
| Camera off, denied or unsupported | Fully usable. Results show in the scanner slot |

#### 5.A7 Toggles (`DoorSettings.tsx`)

- Layout: `flex flex-wrap gap-2`. Each toggle is `Button size="sm" variant="outline"` with `min-h-11`, a fixed name
  and `aria-pressed`. When on, it uses `btn-solid` styling with a leading 20px `check` icon. State is never shown
  by fill alone.
- **"Vibrate":** shown only where `navigator.vibrate` exists. On by default.
- **"Sound":** off by default.
- Both are remembered in `localStorage` (`sheltuh:door-vibrate`, `sheltuh:door-sound`). Storage failures are
  caught, as in `InstallPrompt`.

#### 5.A8 Announcements

- **Assertive:** one visually hidden `aria-live="assertive" aria-atomic="true"` region, mounted on load and never
  unmounted. To repeat identical text, clear it, then set it on the next animation frame. Exact strings:

| Result | Announcement |
| --- | --- |
| Let in | "Let in. General admission, ticket 2 of 3." |
| Already checked in | "Don't let in. Already checked in at 8:42 pm." |
| Void | "Don't let in. Ticket void." |
| Wrong event | "Don't let in. Ticket for {otherEventTitle}." |
| Invalid | "Don't let in. Not a valid ticket." |
| Not a Sheltüh QR | "Don't let in. Not a Sheltüh ticket." |
| Not verified | "Not verified. Don't let in yet. Retry." |

- **Polite:** counters (§5.A2), camera on and off, "Back online.", and undo outcomes (§5.A10).
- **Assertive is reserved for results.** Field errors use `aria-describedby`, plus focus that is already in the
  field.

#### 5.A9 Recent scans (`RecentScans.tsx`)

**Container:** `Panel title="Recent scans" titleId="recent-scans"`. The h2 takes `tabIndex={-1}` as the focus
target after an undo. In the header row on the right: `Button size="sm" variant="outline" min-h-11` "Refresh"
(`busy` while loading).

**List:** `ul` of `summary.recent` (newest first, 20 at most). Rows are
`li.flex.items-center.gap-3.py-3.min-h-14.border-b.border-surface-border`:
- 20px icon. `check` is `text-door-admit`, `cross` is `text-danger`, `undo` is `text-foreground`.
- Text column `flex-1 min-w-0`:
  - Line 1: label (14/20, 600) and, at the right, the time (`formatMessageTime(at)`, 12/16 muted, tabular).
  - Line 2: detail (14/20 muted, `break-words`).
- For `undoable` rows only: `Button size="sm" variant="outline" min-h-11` "Undo", with `<span className="sr-only">`
  " check-in, General admission, code ends 2HXD, 8:42 pm".

| `result` | Label | Detail |
| --- | --- | --- |
| `admitted` | Checked in | General admission · Code ends 2HXD |
| `already_checked_in` | Already checked in | General admission · Code ends 2HXD |
| `not_admissible` | Void | General admission · Code ends 2HXD |
| `other_event` | Wrong event | For {otherEventTitle} · Code ends 2HXD |
| `invalid` | Not valid | Code not recorded |
| `undone` | Undone | General admission · Code ends 2HXD · Reason: {reason} |

New rows (after a refresh) use the existing `fade-in` (150ms, opacity only, reduced-motion safe).

**Empty state:** `p.text-sm.text-muted` "No scans yet. Scanned tickets show here."

**Error state:** keep the old list and show `Notice tone="danger"` "Couldn't refresh the list. It updates again
when you're back online."

#### 5.A10 Undo dialog (`UndoCheckInDialog.tsx`)

Follow `ReportDialog`: a native `<dialog>`, bottom sheet on phones, centred from `sm`, with the form remounted on
each open. Render it inside the door wrapper so it inherits the ink tokens. Backdrop: `backdrop:bg-black/80`, not
`foreground/50`, which would be a paper glare in the door scope.

**Anatomy:**
- h2 `display-md !text-2xl`: "Undo this check-in?"
- `p#undo-about.text-sm`: "General admission · code ends 2HXD · checked in 8:42 pm. They'll count as not checked
  in, and the ticket can be scanned again."
- `Field`:
  - Label "Reason". Hint "Kept in the check-in log. 3 to 200 characters."
  - Input `fieldClass`, `maxLength={200}`, autofocused on open.
- Suggestions: `flex flex-wrap gap-2` of `Button size="sm" variant="outline" min-h-11`: "Scanned by mistake",
  "Wrong ticket scanned", "Letting them back in". A tap fills the input and doesn't submit. Focus stays on the
  chip.
- Actions `flex flex-col gap-3 sm:flex-row`:
  - `Button type="submit" variant="danger" size="lg"` "Undo check-in", with the busy label "Undoing…".
  - `Button variant="outline" size="lg"` "Keep it".

**Outcomes:**

| Result | Behaviour and copy |
| --- | --- |
| Under 3 characters (client side) | "Give a reason of at least 3 characters." Inline, focus to the input |
| 400 `fieldErrors.reason` | Show the server message inline |
| `undone` | Close. Polite: "Check-in undone. General admission, code ends 2HXD." Refresh. Focus to the "Recent scans" h2. Decrement `checkedIn` locally |
| `not_checked_in` | Close. Polite: "That check-in was already undone." Refresh. Focus to the h2 |
| `superseded` | Stay open. `Notice tone="danger"`: "This ticket was checked in again since. Close this and undo the newer check-in instead." |
| 404 | Stay open. Notice: "That check-in can't be found. Refresh the list and try again." |
| 429 | Stay open. Notice: "Too many scans and undos right now. Wait a few seconds and try again." |
| Network or 5xx | Stay open. Notice: "Couldn't undo. Nothing changed. Check your connection and try again." |
| 401 | Stay open. Notice: "You've been signed out. Sign in again to undo." plus a sign-in link |

#### 5.A11 By ticket type (`DoorTicketTypes.tsx`)

- **Phones:** `<details>` with `<summary className="inline-flex min-h-11 items-center eyebrow underline
  underline-offset-4">` "By ticket type". On `md+` it's an open `Panel title="By ticket type"`.
- **Rows:** `dl` rows `py-3 border-b border-surface-border grid grid-cols-[1fr_auto] gap-x-3`:
  - `dt.text-sm`: the name.
  - `dd.text-sm.tabular-nums.text-right`: "100 of 180 in", then `text-xs text-muted` "Capacity 200".
  - A full-row `h-1` bar under each (as §5.A2, `aria-hidden`).
- **Empty:** "This event has no ticket types."

#### 5.A12 How check-in works (static `<details>`)

Summary "How check-in works". The body is a `ul.text-sm.text-muted.flex.flex-col.gap-2`:
- "Each ticket gets in once. A second scan shows Already checked in, with the time of the first."
- "Not verified means nothing was checked. Don't let anyone in on that scan: retry, or type the code."
- "Use Undo in Recent scans if you checked in the wrong ticket, or to let someone back in. You'll need a reason."
- "Use the torch for paper tickets. Turn it off for phone screens: it causes glare."
- "In a dark room, set your screen to about half brightness. Results are still easy to see."
- "Everyone on the door signs in with this organiser account."

#### 5.A13 Focus order and targets

1. Skip link
2. Nav
3. Offline banner (not focusable)
4. "← Your events"
5. Scanner-slot controls: Start camera, or Torch then Stop camera, or the result's Retry / Scan next / Sign in
6. Manual input
7. Check
8. Vibrate
9. Sound
10. By ticket type
11. Refresh
12. Undo buttons, top to bottom
13. How check-in works
14. Footer

Focus moves only as follows:
- Start ↔ Stop swap.
- Error states focus their h2.
- An undo focuses the "Recent scans" h2.
- The dialog autofocuses its input and returns focus on close (native).

Results never steal focus. Every interactive element is at least 44×44 (`min-h-11`; primary actions `size="lg"`,
48px).

#### 5.A14 Dashboard entry point (`DashboardContent.tsx`)

- For `published` events only, add a "Check-in" link next to "Analytics", to `/dashboard/{id}/check-in`. It uses the
  same `eyebrow inline-flex min-h-11 items-center border-l border-background px-4 underline underline-offset-4`
  classes, with `<span className="sr-only">for {title}</span>`.
- **Under `sm`:** the `li` becomes `flex-col`. The main link stays first, followed by a `grid grid-cols-2` row
  (`border-t border-background`) holding Analytics and Check-in. That keeps the title from being squeezed to under
  100px at 320.
- **From `sm`:** the current single row, with both links.

### Part B: the QR ticket

#### 5.B1 `components/tickets/TicketQr.tsx` (new)

- **Encoding:** `ticketQrPayload(code)` (`SH1:XXXX-XXXX`) through the vendored MIT `qrcodegen`. Use
  `encodeText(payload, Ecc.QUARTILE)`, which gives alphanumeric mode (upper case, `:` and `-` are in the set) and
  **version 1: 21×21 modules**. Quartile survives scuffed screens and glare. Mask is automatic.
- **Render:** `<svg viewBox="0 0 29 29" shapeRendering="crispEdges" role="img" aria-label="Ticket QR code">`. That
  is 21 modules plus a **4-module quiet zone** on every side, built from size + 8. Inside it, a
  `<rect width="29" height="29" fill="#ffffff"/>` and one `<path fill="#000000" d="…">` for the dark modules. The
  colours are presentation attributes, never `currentColor` or tokens, so no theme, scope or `[data-door]` can tint
  them.
- **Wrapper `div`:** `style={{ forcedColorAdjust: "none", printColorAdjust: "exact", colorScheme: "only light" }}`.
- **Size** (integer module sizes: 29 × 7 and 29 × 8):

| Context | Plate size (quiet zone included) | Module |
| --- | --- | --- |
| Under 375px | `size-[203px]` | 7px |
| 375px and up (including tablet and desktop) | `min-[375px]:size-[232px]` | 8px |
| Print | `print:size-[40mm]` | ≈1.4mm |

  At 320 the stub's content box is 222px, so 203 fits. If a future payload ever needs version 2 (33 modules), the
  plate keeps its size and modules become fractional (still at least 6px).

#### 5.B2 `components/tickets/TicketStub.tsx` (changed)

Drop `LinearBarcode`. Delete `components/tickets/LinearBarcode.tsx` if nothing else imports it.
`lib/barcode/code128` stays, because `UBarcode` uses it.

**Phones (under 640px):** `li.border.border-foreground.print:break-inside-avoid`

```
┌─────────────────────────────────────┐
│ GENERAL ADMISSION            [ü-bar]│  p-4, flex justify-between items-start gap-3
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤  border-t border-dashed border-foreground (perforation)
│          ┌───────────────┐          │
│          │   QR 203/232  │          │  p-4 flex flex-col items-center gap-3
│          └───────────────┘          │
│             7KQM-2HXD               │  font-mono text-xl tracking-wider sm:text-2xl sm:tracking-widest select-all
│   Turn your brightness up at the    │  text-xs text-muted text-center print:hidden
│   door.                             │
└─────────────────────────────────────┘
```

- Header: `p.eyebrow.text-muted` with the type name. `UBarcode` is `h-12 w-auto` (48px), still `aria-hidden`.
  It's the brand mark, and it's kept small so it doesn't compete with the scannable code.
- The code text is the existing visible text. Applying the `mobile.md` §3.3(l) size fix here keeps it on one line at
  320.

**640px and up:** `grid grid-cols-[1fr_auto]`
- Left (`p-5 flex flex-col justify-between gap-4`): eyebrow type, then the code (`font-mono text-2xl
  tracking-widest`), the hint, and `UBarcode h-28 w-auto` at the bottom-left.
- Right (`p-5 border-l border-dashed border-foreground`): the 232px QR.

**States:** the stub only renders for a `paid`, ready order (as today). Loading, not-found, error and oversold
states in `CheckoutConfirmation` are unchanged and show no QR.

#### 5.B3 `CheckoutConfirmation.tsx` copy (ready state only)

Replace "Show this page or your ticket email at the door." with three `p.text-xs.text-muted`:
1. "Show a QR code at the door, from this page or your ticket email."
2. "This page needs a connection. If signal at the venue is patchy, take a screenshot first."
3. "Each code gets in once, so don't post or share it."

The order-reference line stays. If the ticket email doesn't carry a QR yet when this ships, line 1 becomes "Show
the QR code on this page at the door, or the code in your ticket email." (§7).

**Brightness hint:** web pages can't set screen brightness. The hint under each QR, "Turn your brightness up at the
door.", is the only lever. It's deliberately next to the code rather than in a banner.

#### 5.B4 Print and PWA

- **Print:**
  - `print:break-inside-avoid` on each stub.
  - The QR at 40mm with `print-color-adjust: exact`.
  - The hint is `print:hidden`.
  - The panel's `bg-surface` becomes `print:bg-transparent`, so the QR's white plate prints on white paper.
- **PWA:** nothing changes. Pages and API responses stay uncached (`docs/pwa.md`). The screenshot advice is the
  offline story; caching tickets would undo the privacy design. Standalone mode uses the same layout.
- **Dark modes:** Chrome's Auto Dark Mode and Samsung Internet's dark mode can invert page content. The
  `color-scheme: only light` wrapper is meant to opt the plate out. **Verify on a device** (§7). If any browser
  still inverts it, the scanner's ZXing path should enable inverted-code reading (`tryInvert`).

---

## 6. Motion

| What | Behaviour | Why | Reduced motion |
| --- | --- | --- | --- |
| Result panels | Appear and disappear instantly. No fade, slide or scale | The fastest possible read, and no motion to mistake for flashing | Same |
| Result cadence | Changes at most once a second (minimum holds, §5.A4) | WCAG 2.3.1 general and red flash thresholds | Same |
| Checking layer | Static text after 250ms, no spinner | No perceptible flicker on fast responses | Same |
| Reticle | Static corners, no scan line | Nothing pulsing in a dark room | Same |
| New Recent-scan rows | Existing `fade-in`, 150ms, opacity only | Marks what changed | Off (existing media query) |
| Scroll to the scanner on Start | Instant (`behavior: "auto"`) | Keeps the viewfinder and manual entry in view | Same |
| Dialog | Native, no animation | — | Same |
| Vibration and sound | §5.A4 patterns | Non-visual signal in noise | Not motion; governed by the toggles |
| QR ticket | Nothing moves | — | — |

---

## 7. Dependencies, proposals and out of scope

**Dependencies (for the manager to route):**
- **`qrcodegen` (MIT)**, vendored as a single file per `REMEDIATION_PLAN.md`. It's shared with the ticket-email PNG
  (backend).
- **`barcode-detector` polyfill (MIT, ZXing-WASM)**: a new npm dependency, dynamically imported on this route only.
  **Self-host the `.wasm`.** Its default loader fetches from a CDN, which would be a new third-party request. If a
  CSP is ever added, it needs `'wasm-unsafe-eval'` on this route.
- **Ticket email QR (backend):** the copy in §5.B3 assumes it exists. Otherwise use the fallback line.
- **`offline.html`:** after the email QR ships, change "The confirmation email lists the codes" to "Your ticket QR
  codes are in your confirmation email." This is a static-file copy edit.
- **Tests (test-engineer):**
  - `tests/TicketStub.test.tsx` currently expects two `aria-hidden` SVGs. After this change it has one
    (`UBarcode`) plus one `role="img"` QR.
  - New guard test for the door tokens (§2.1).
- **Real-device checks (visual-qa):** iPhone Safari, which uses the WASM path. Android Chrome torch and vibration.
  Auto Dark Mode and Samsung dark mode against the QR plate. 320×568 fit with the camera live.

**Proposals (behaviour decisions for the manager; recommended default in brackets):**
1. A decoded QR that isn't a Sheltüh code shows "Not a Sheltüh ticket" locally, without a request, so it isn't
   logged. [yes; it saves rate limit, and the server would only log an `invalid` row]
2. Vibrate is on and Sound is off by default, remembered per device. [yes]
3. The summary is polled every 15s while visible, plus after each action. [yes]
4. Nav becomes non-sticky on the check-in route. [yes]
5. The dashboard shows the Check-in link for `published` events only. [yes]
6. `print:hidden` on Nav and Footer, so a printed confirmation is just the tickets. [optional; it touches shared
   chrome]
7. Show "Ticket n of N" on each stub. This needs `order.tickets` in the ticket email's order (ticket type id, then
   code). [only if the backend confirms that ordering]

**Out of scope:**
- Offline check-in (architecture: not supported).
- Per-event door-staff accounts.
- Buyer names on scan (privacy).
- Bulk or list-based check-in.
- A camera switcher (rear only).
- Wallet passes (Apple and Google).
- Any change to fees, checkout or the check-in API contract.
