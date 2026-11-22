# Navigation, search, filters and the new Figma boards (implementation spec)

Source: Latte's Figma boards, sent by the owner on 18 Nov 2026 as screenshots:
- the component boards: "Menu drawer / Mobile", "Navigation", "Search field", "Search sheet / Mobile", "Filter
  dropdown", "Search / Mobile", "Filters", "Filter sheet / Mobile" and "Icons & assets";
- the desktop sign-in page;
- the /community panels ("Local discovery", "Word of mouth", "You choose who sees you") and the /community hero;
- the full page "Community — Desktop 1440 - Dark (on hold)".

They're compared with `main` (`/var/tmp/sheltuh-nav`), and with the r2p2 branch (`/var/tmp/sheltuh-r2p2`) for the
sign-in work, since it has the latest `AuthShell`.

**How this was measured.** The screenshots were scaled by their frame widths (1440px desktop, 390px phone), so
values are ±4px. When a screenshot can't settle a value, the existing token stays and the question goes to Latte
(§9.2). Nothing in this spec reverses a Round 2 decision or an owner amendment (`round-2-handoff.md`). Where Figma
disagrees with one of them, the earlier decision wins, and the row says so.

**Rules that override the boards everywhere.** These are owner decisions, not open questions:
- **No mono capitals.** The boards set some labels in mono uppercase ("WHERE", "WHEN", "RECENT", "DATE", "EMAIL",
  "ACCOUNT", "FAN SUPPORT", "NORTHCOTE", "@LATTE · 2 UPCOMING", "← SWIPE / SCROLL →"). Set them in Instrument Sans,
  sentence case, as written: `eyebrow` (12/16, 500) or `meta` / `mono-s` (12/16, 400, tabular). The boards predate
  the owner's 13 Nov decision on this.
- **Copy is sentence case.** Use "Sign out", not "Log out", to match /account and the rest of the site.
  *Superseded for the header, the avatar menu and the drawer (owner, 19 Nov 2026: the build copies the boards
  exactly): the avatar menu says "Log out", as drawn. See §5.16, which overrides every section here for those three.*
- **Prices are all-inclusive.** Every price band is computed from `lib/fees.ts` through `getMinBuyerTotalCents`.
- **Real, privacy-permitted data only.** The boards' counts, "2 you know", "Jay saved this" and avatar stacks are
  placeholders.
- **Mock photos are placeholders.** See §4.4. None of the photos, posters or logos on the boards may ship.

Breakpoints follow Round 2: S below 768 (base, and `sm:` from 640), M 768–1023 (`md:`), L 1024–1279 (`lg:`), XL
from 1280 (`xl:`). Verify at 1440, 1280, 1024, 768, 390 and 320, in Light and Dark, in demo and live.

---

## 1. Principles

1. **One place per thing.** Search has one sheet and filters have one sheet. Account links have one menu on
   desktop and one drawer on phones. Each reuses the shared components (`FilterChip`, `FilterDropdown`,
   `LocationPicker`, `CountBadge`) rather than look-alikes.
2. **Choose first, then commit.** The boards' "Search →" and "Show 27 events →" are commit buttons pinned to the
   bottom of a sheet. Nothing in a sheet changes the page until one is pressed, and closing a sheet discards its
   draft (WCAG 3.2.2).
3. **Scale contrast carries the hierarchy.** In the drawer, the three places are 40px bold and the account rows are
   16px, with nothing else competing. It works like a magazine's contents page: big words, quiet furniture. The
   two-dot umlaut stays the one "you are here" mark.
4. **Counts only when they're true.** A count shows only when the API can give this person's real number.
   Otherwise the label drops it ("Show events", no tickets count). Never show a number that isn't known.
5. **Every hover has a twin.** Each hover state has the same look on `:focus-visible`, and a press look on touch.
   Sheets and the drawer trap focus, close on Escape, and return focus to what opened them.
6. **Token-first.** The two new sizes below are named utilities. No one-off `text-[…]` values and no new colours.

## 2. Tokens (`app/globals.css`)

No colour changes. All pairs below already exist and pass AA.

| Pair | Ratio | Used for |
| --- | --- | --- |
| `--foreground` on `--background` (black/white, both themes) | 21:1 | all text |
| `--muted` #5c5c5c on white / on `--hover` cream / on `--surface` | 6.69 / 6.48 / 6.03:1 | eyebrows, sublines, counts |
| `--muted` #a3a3a3 (Dark, ink) on black / on `--card` #141414 | 8.33 / 7.33:1 | the same, in Dark and ink |
| `--signal-foreground` on `--signal` (black on orange) | 6.18:1 | Sign in, Search, Show N events, unread badge |
| `--signal` dots on black | 6.18:1 (non-text) | the drawer's current-place dots |
| `--signal` dots on white | 3.40:1 (non-text, ≥3:1) | header dots, always paired with an underline or fill |
| black text on `--hover` #fffae7 (the cream search field) | ≈20:1 | the search sheet's field |
| white text on `--hover` #1a1a1a (Dark) | ≈17:1 | the same field in Dark |

**New utilities** (add them in the type block, after `label-tag`):

| Utility | Family | Size / line | Weight | Tracking | Case | Use |
| --- | --- | --- | --- | --- | --- | --- |
| `label-menu` | `--face-sans` | 2.5rem / 3rem (40/48) at every width | 700 | −0.015em | as written (sentence) | the drawer's Discover / Nearby / Community |
| `umlaut-side` | (modifier for `umlaut`) | dots 20×8px, `--umlaut-left: 0`, `--umlaut-x: 0`, `--umlaut-top: calc(50% - 4px)`, `--umlaut-line: none` | – | – | – | the drawer's dots, left of the word and centred on it (§5.3); the city list's active city (§5.15) |

The current drawer items use `display-m`: Bootzy capitals, 40/48, and 56/64 from 768px. On the 390 frame the board
draws Instrument Sans Bold, sentence case, at about 40px, so `label-menu` replaces `display-m` there.

**Unchanged, and confirmed against the boards** (*superseded for the header, the avatar menu and the drawer by
§5.16: `--header-h` is now 64 / 100, `label-nav` 18/24, and `nav-button`, `nav-chip`, `nav-avatar` and
`umlaut-nav` take the board's measurements*):
- `--header-h` (56 / 72)
- `label-nav` 16/24 500
- `nav-button`: 40px, 1.5px stroke, radius 8, cream on hover, filled when current
- `nav-chip` (32px, 14/20) and `nav-avatar` (40px square)
- `umlaut-nav`: 20×6 dots, underline 12px below
- `filterChipClass` (48px), `FilterDropdown` (48px) and `.btn-lg` (56px)
- `--radius-control` 8, `--radius-sheet` 16, `--stroke-control` 1.5px

**Spacing, borders and radii:**
- Spacing uses the 8px scale only.
- Borders: 1.5px `--foreground` for controls and menus; 1px `--surface-border` for dividers and hairlines.
- Radii: 8 for the menu, chips and fields; 16 for the tops of sheets.

**Motion tokens:**
- Colour changes: 200ms ease-out (existing).
- Sheet entry: `translate` from 100% to 0 over 200ms ease-out. The drawer and the menu fade in (`opacity` 0→1)
  over 150ms ease-out.
- Both use `@starting-style` plus `transition-behavior: allow-discrete` on `display` and `overlay`, inside
  `@media (prefers-reduced-motion: no-preference)`. Under reduced motion they appear at once.
- The chevron rotation is unchanged (200ms, `motion-safe:`).

## 3. Grid and layout

| Surface | S (from 320) | M | L | XL |
| --- | --- | --- | --- | --- |
| Header row | compact bar, `h-14`, `page-container` | same | one row, `h-18`, `px-8` | `h-18`, `h-16` once scrolled, `px-16` |
| Phone drawer | full width under the bar, `page-container` (16 / 32 sides), full height minus the bar | same | hidden | hidden |
| Avatar menu | – | – | popover `w-72` (288px), right edge on the avatar's right edge, 8px under the header's bottom | same |
| Search sheet | full screen, `p-4`, 64px top bar, Search pinned to the bottom | same (Round 2: the sheet runs to 1023) | inline bar (unchanged) | same |
| Filter sheet | bottom sheet, full width, `max-h-4/5`, `px-4`, Show pinned | same | the dropdown row instead (§5.9) | same |

The Figma desktop header frames measure about 96px tall. That predates Round 2's 72px (64 once scrolled at XL),
so **keep 72**. *Superseded (19 Nov 2026): the header is the board's 100px, 92 once scrolled at XL; the avatar
menu is 280px. See §5.16.*

## 4. Imagery

### 4.1 Avatars (avatar menu, drawer)
- Round, as people's avatars are in design-system.md: 40px in the avatar menu, 48px in the drawer.
- Photo: `ProfileRecord.avatarThumbUrl` (96px), fetched with the bearer token through
  `lib/api/profiles.ts fetchAvatar` and shown from an object URL. Never put the URL in `<img src>` directly.
- Fallback (no profile, no photo, still loading, or the fetch failed): `InitialsAvatar`, using initials from
  `displayName`, or the email's first letter (as `initialFor` does in `AuthNavLinks.tsx`). The board's cream
  circle is a photo placeholder, not a style. *Superseded (19 Nov 2026): the fallback is the board's cream
  circle, with no initials. See §5.16.*
- The header's 40px square avatar stays the square initial (`nav-avatar`), as drawn.

### 4.2 Event images (Local discovery, anything in a sheet)
EventCard's existing rules apply: a 2:1 image, the `imageFocus` focal point, `fit="auto"`, and **EventArt's poster
art when there's no `imageUrl`** (`lib/types.ts`: `imageUrl` is optional). The boards' cards all have photos, but
every surface here must also look right with EventArt.

### 4.3 Text on images
Text never sits on a photo in these components. On the sign-in page the card is a solid `--background` panel over
the photo, as now. Exception, on hold: the "melbourne" sticker on the Scenes by city photo (§5.15) is an opaque
white label, so it never relies on the photo for contrast.

### 4.4 Mock photos and assets are placeholders only
The boards' photos include **identifiable people** (sign-in, the /community collage, the Scenes by city photo,
Local discovery cards), **brand logos** (an LA cap, Budweiser, a "[BRAND]" placeholder) and **third-party event
posters** ("Here & Now", "Emerging events/brands/creatives", "Interconnect Studios"). They're layout placeholders.
**None of them may be used on the site** unless its provenance and permission are recorded in
`public/events/README.md` first. The Unsplash licence that covers our current photos gives **no model release and
no trademark clearance**. Layouts use our licensed photos (`AUTH_PHOTO`, `COMMUNITY_COLLAGE`, `SCENES_PHOTO`) or
real events' own photos.

The **hand-drawn orange smiley marks** on people's faces are a brand graphic worth having. Ask Latte for them as
SVG (§9.2). Never place them on the face of an identifiable person who hasn't released their likeness. They're
fine on licensed photos without people, and on EventArt.

## 5. Components

Each subsection compares what's in the repo now with the board, then says what changes.

### 5.1 Desktop header (`components/Nav.tsx`, `components/AuthNavLinks.tsx` `HeaderAccount`)

| Part | Current | Figma | Change |
| --- | --- | --- | --- |
| Surface | Black in both themes (`data-surface="ink"`, D7 in theme-white-dark.md), with a 1px rule in Dark | **Light** frame white with a 1px grey bottom rule; **Dark** frame black | **Owner Q1 (18 Nov): follow the theme.** Built as below. |
| Height | 72 (64 once scrolled at XL) | ≈96 | Keep 72 (Round 2). |
| Wordmark | `Wordmark h-5` in the text colour | black on Light, white on Dark | Matches. |
| Gaps | logo→nav 32, items 32, actions 32 (`gap-8`) | ≈32 each | Matches. |
| Nav items | Discover, Nearby, Community. `label-nav` 16/24. Dots on hover; dots plus a 2px underline 12px below when current (`umlaut umlaut-nav`). | the same states, Light and Dark (the Community dark page shows "Community" current) | Matches. |
| Signed out, right | "Sign in" nav item, then the "For organisers" `nav-button` | the same | Matches. |
| Signed in, For organisers | **a plain nav item** (`headerNavClass`) | **the outlined `nav-button`**, as when signed out | Change: `headerButtonClass` (`umlaut nav-button`). |
| Signed in, Messages | `nav-chip` with an orange `CountBadge` (`tone="signal"`), none at 0 | the same (white with a grey stroke in Light; dark fill in Dark) | Matches. The Dark fill is §9.2 Q1. |
| Signed in, avatar | `nav-avatar` square with the initial and a caret, **linking to /account** | the same square, which opens the **avatar menu** | Change: a button that opens §5.2. |
| Admin (admins) | "Admin" with the waiting count | not drawn | Keep, between For organisers and Messages. Don't remove functionality. |
| Nav button states | default, hover (cream; `--hover` #1a1a1a in ink), current (filled) | 6 states: Light and Dark default, hover, current | Matches. |
| Loading auth | "…" (`label-nav text-muted`) | not drawn | Keep. |
| Demo | Sign in (with its "not configured" title) and For organisers | – | Keep. There's never an avatar menu in demo. |

**Q1 said "follow the theme"** (18 Nov), so from `lg` only:
- Remove `data-surface="ink"` from the desktop row's wrapper. The compact bar and drawer stay ink, because the
  board draws "Header / Mobile" black.
- Give the header `bg-background` and a 1px `--surface-border` bottom rule (the existing `after:` rule, now shown
  in both themes).
- Dots on white are 3.40:1, and the current item keeps its 2px underline, so state never rests on colour alone.
- Update `theme-white-dark.md` D7 and the `tests/Nav.test.tsx` and e2e header ink assertions.

### 5.2 Avatar menu (new; `components/AuthNavLinks.tsx`, from `lg`)

**Pattern:** a **disclosure**, not `role="menu"`.
- The avatar becomes a `<button aria-expanded aria-controls aria-label="Account">`. The visible initial is
  decorative.
- It toggles a `popover="auto"` panel holding a `<nav aria-label="Account">`, with a list of links and one Sign
  out button.
- Tab and Shift+Tab move through the panel. Escape or an outside click closes it and returns focus to the avatar.
  Tabbing out of the panel closes it too (the same `focusout` rule as `Nav.tsx`'s menu).
- When the current page is in the menu (/account, /saved, /messages…), the avatar keeps its dots: set
  `data-current` and style it like `aria-current`.

**Where it renders:** as a DOM sibling **after** `<header>`, not inside it. That way it takes the page theme
(white in Light, black in Dark), as both frames draw, rather than the ink header's.
- Position it on `beforetoggle`, with `position: fixed`:
  - `top = header.getBoundingClientRect().bottom + 8px`
  - `right = viewport width − avatar.getBoundingClientRect().right`
- A popover with a `popovertarget` invoker comes right after its invoker in the focus order, so its DOM position
  doesn't break the tab sequence.

**Anatomy:** a `w-72` panel, `rounded-control`, `border-control border-foreground`, `bg-card`, `p-2`, no shadow.

| Row | Content | Spec |
| --- | --- | --- |
| Identity | avatar (40px round, §4.1), name, line 2 | `flex items-center gap-3 px-2 py-3`. Name: `body-m font-semibold truncate`, from `displayName`, else the email. Line 2: `meta text-muted truncate`. The board's "@latte · 2 upcoming" can't be built: **there's no @handle in the data** (only an optional Instagram handle, which is a different identity and isn't shown). So line 2 is the email when a display name exists, otherwise nothing. Once B1 lands, it becomes "{n} upcoming" (n ≥ 1; nothing at 0). This row isn't a link. |
| divider | | `my-2 h-px bg-surface-border` |
| Profile | → `/members/{profileId}` when `profileVisible`, else `/account#member-profile` | row (below) |
| My tickets | count on the right | **Owner Q2 (18 Nov):** shown now, linking to today's tickets page (Help's "Where are my tickets?", `/help#where-are-my-tickets`, as /login's "Find my tickets") until the My tickets list (B1) lands. No count until B1. |
| Saved | → `/saved`. Count: `useFavourites().count`, when `status === "ready"` and above 0 | count `meta text-muted tabular-nums`, a plain number (as drawn), with sr-only ", {n} saved" |
| Messages | → `/messages`, `CountBadge tone="signal"` from `useUnread()` | as on the header chip; sr ", {n} unread" |
| Your events | → `/dashboard` | organisers and applicants only (`useOrganiser`, as /account decides) |
| Admin | → `/admin`, with the plain `CountBadge` waiting count | admins only |
| Settings | → `/account` | |
| divider | | as above |
| Sign out | `<button>`: `auth.signOut()`, then `router.push("/")` (as /account) | **`text-foreground`**, not orange. The board's orange "Log out" breaks the rule "Signal Orange is for the main action only; never small orange text on white". |

**Rows:** `flex min-h-12 w-full items-center justify-between gap-3 rounded-control px-2 text-sm leading-5
font-semibold`. That's the location menu's row: 48px rather than the board's ≈40, which keeps targets at 44px or
more.
- Hover and `focus-visible`: `bg-hover dark:bg-surface`. That's cream in Light, as drawn on "My tickets", and
  `#1f1f1f` in Dark, because Dark's `--hover` (#1a1a1a) doesn't show against `--card` (#141414).
- Current page: `aria-current="page"`, the `umlaut` dots on the label, and the 2px underline.
- Active (touch): `bg-surface`.

**States:**
- Profile loading: a 40px `bg-surface` circle and the email.
- Profile failed: the initials and the email; the menu still works.
- Counts that haven't loaded aren't shown: no "0", no spinner.

**Accessibility:**
- Counts are never live regions, because they change in the background. They're read as part of each link's name.
- Every target is at least 48px tall.

### 5.3 Phone header and drawer (`components/Nav.tsx` compact bar and `#site-menu`; `MenuAccount`)

| Part | Current | Figma | Change |
| --- | --- | --- | --- |
| Bar logo | the ü `UMark`, 32px tall, in the text colour | the **orange `SHELTÜH` wordmark**, ≈20px tall (≈88 wide) | `Wordmark className="h-5 w-auto text-signal"` inside the 48px link. Orange on black is 6.18:1, and as a logo it's non-text. Confirm with Latte (§9.2 Q2): this board is newer than the Mobile (390) ü spec. |
| Bar actions | Search (a link to `/search`, not on `/`), then Menu, which turns into Close and carries the unread count | Search, Menu; inside the drawer, only the wordmark and ✕ | Keep Search hidden on `/` (Round 2 B10). **Hide Search while the drawer is open**, as drawn; that's also one fewer tab stop outside the drawer. Search opens the sheet (§5.5). |
| Bar height | 56 | 56 | Matches. |
| Drawer surface | ink, under the bar, `border-t border-surface-border` | black, no rule | Remove the `border-t`. |
| Places | `display-m` (Bootzy caps, 40/48), `umlaut umlaut-lg` (20×8 dots **over the first letter**), `pt-4 pb-2`, `gap-2` (80px pitch) | Instrument Sans Bold, sentence case, ≈40px, on a **72px pitch**. Dots **left of the word**, vertically centred, 16px from the edge. All three words aligned 40px in from the page margin. | `label-menu umlaut umlaut-side block py-3 pl-10` (12 + 48 + 12 = 72). The list gets `pt-10` and no gap. The current place shows the dots with no underline; other places show them on hover. The dots' shape carries the state (not colour alone), and `aria-current` stays. |
| Signed out, bottom | Sign in `btn btn-solid btn-lg w-full` (white in ink), For organisers `btn-outline btn-lg`, 16px gap, `border-t pt-6` above | **Sign in orange**, For organisers outlined, both 56px, 16px apart, 32px from the bottom, no rule above | Sign in → `btn btn-signal btn-lg w-full`. Remove the `border-t pt-6` when signed out (keep `mt-auto`). |
| Signed in, bottom | `border-t`; rows Admin, Messages (badge), Saved, Your events, Account (48px, `label-nav`); For organisers `btn-outline btn-lg` | **identity block** (48px round avatar, name 16/24 600, "View profile" 12/16 muted), then rows **My tickets / Saved / Messages**, each ≈64px with 1px hairlines above; For organisers outlined | See the block below. |
| Theme switch | footer only | not in the drawer | Matches. |

**Signed-in account block (drawer):**
```
div mt-auto flex flex-col                                   (no border-t)
  Link[identity] href=profile (as §5.2)  flex min-h-16 items-center gap-4 pb-4
    Avatar 48px round (§4.1)
    span flex-col: name  label-nav font-semibold truncate
                   "View profile"  meta text-muted
  ul
    li border-t border-surface-border → Link flex min-h-16 items-center justify-between label-nav
       My tickets   → /help#where-are-my-tickets until B1 (owner Q2), no count
       Saved        + count (meta text-muted tabular-nums, sr ", n saved")
       Messages     + CountBadge tone="signal" (keep: the board omits it, but it's how phones see new messages)
       Your events  (as now)
       Admin        + waiting count (admins)
  For organisers  btn btn-outline btn-lg w-full mt-6
```
- The identity link's accessible name is "{name}, view profile". It replaces the Account row.
- The bar's Menu button keeps its unread badge, with the count in words in its name.

**States:**
- Auth loading: a 48px `bg-surface` circle and "…", then For organisers.
- Demo: the signed-out block.

**Accessibility.** The mechanics are unchanged; re-checked:
- It's a native popover. `main` and `footer` are `inert` while it's open.
- Focus goes to the first place on open. Escape or an outside tap closes it, and focus returns to Menu. Tabbing out
  closes it.
- `nav aria-label="Site menu"`.
- Targets: places at least 72px tall, rows 64px, buttons 56px.
- At 320px with 200% text, places may wrap (`break-words`), but nothing may be clipped.

### 5.4 Search field Where segment (`components/search/LocationPicker.tsx`, bar mode, from `lg`)

| State | Current | Figma | Change |
| --- | --- | --- | --- |
| Default | pin; "Where" `eyebrow text-muted` over the place (`text-sm font-semibold`); chevron down; transparent border | the same (with the label in mono caps) | Matches. The label stays sentence case. |
| Hover | `hover:bg-hover` (cream) | cream | Matches. Add the twin, `focus-visible:bg-hover` (keep the inset ring). |
| Open | `data-open`: cream, 1.5px foreground stroke, chevron rotated 180° | the same | Matches. |

### 5.5 Search: phone trigger and search sheet (`components/SearchBar.tsx` below `lg`, `SearchSuggestions.tsx`)

**Trigger ("Search / Mobile")**

| Part | Current | Figma | Change |
| --- | --- | --- | --- |
| Size | `min-h-12`, one line | two lines, ≈56px | `min-h-14 py-2`. |
| Content | icon, then "Search events" (muted placeholder) or the query | icon, **"Search events"** (semibold), subline **"Caulfield East · Anytime"** | Line 1: `label-button text-foreground` (or the query, truncated). Line 2: `meta text-muted truncate`, showing the place (`readStoredNear`, else "All of Australia"). **" · {when}" is added only in increment 4.** |
| Name | its words, or "Search events: {q}" | – | No `aria-label`. The name is the visible text ("Search events Caulfield East"), so the label is in the name. Set the " · " to `aria-hidden`. |

**Header Search icon** (below `lg`, not on `/`): it's a link to `/search` today. **Proposal P1:** make it a
`popovertarget` button that opens the search sheet in place, with the link as the no-JS fallback.

**Sheet ("Search sheet / Mobile")**

| Part | Current | Figma | Change |
| --- | --- | --- | --- |
| Top | a row with ✕ on the right (48px); the field on its own row: white, with a search icon inside and the global 1.5px stroke | **one row**: ← back, then a **cream** field with a 1.5px black stroke, radius 8, no icon, placeholder "Search events, venues, artists" | Row `flex h-16 items-center gap-2`. Back: `size-12` button, `ArrowLeftIcon size-6`, `aria-label="Close search"`, `popovertargetaction="hide"`. Field: `h-12 flex-1 rounded-control border-control border-foreground bg-hover px-4 text-base` (16px, so iOS doesn't zoom), placeholder as drawn. The label stays "Search events" (sr-only). |
| Where | a full-width bordered field (pin, "Where", place, chevron down) that opens the location bottom sheet | a **list row**: "Where" over the place, chevron **right**, a 1px hairline under it, no box | LocationPicker gets an additive `variant="row"`: `flex min-h-16 w-full items-center gap-3 border-b border-surface-border py-3 text-left`, the eyebrow "Where" muted, the place `text-sm leading-5 font-semibold`, `ChevronRightIcon size-5`. Hover and focus: `bg-hover`. It opens the same bottom sheet as now. |
| Use my location | only inside the location sheet | **a row in the sheet**: target icon, "Use my current location" | Row button `flex min-h-12 items-center gap-3 text-sm leading-5 font-semibold`, `DistanceIcon size-5`, shown only when `hasGeolocation()`. It calls the **same** `locateMe`: expose it from LocationPicker, and write no new geolocation code. It announces through the existing status region. Keep the copy "Use my location", so both ways in say the same thing. |
| When | not built (`/search` reads only `q` and `near`) | "When", with chips **Anytime** (selected), Tonight, This weekend, Pick dates | **Increment 4, blocked on B2.** `FilterChip`s, `flex flex-wrap gap-2`, single choice, Anytime pressed by default. The board draws ≈40px chips; keep 48. |
| Recent | none; suggestions show categories and a few events coming up while the field is empty | "Recent", up to 3 rows with a history icon ("High Note", "Thrift market Fitzroy", "Jazz this weekend") | **New, waits for owner Q6.** Add a `recent` group at the **top** of the existing `SearchSuggestions` listbox, so arrow keys, `aria-activedescendant` and Enter work as now; the other groups follow. Row: `min-h-12`, `HistoryIcon size-5 text-muted` (a new icon, §5.10), label `body-m`. Picking a row runs `/search?q=…` with the bar's own place. "Clear" sits on the right of the group heading: a `label-button min-h-11 px-2 underline` button **outside** the listbox (a button can't be an option). It empties the list and announces "Recent searches cleared". |
| Search button | `btn btn-signal btn-lg w-full`, search icon **before** "Search", in the flow under Where | **pinned to the bottom**, "Search" with the **arrow after** it | The sheet becomes `flex flex-col`. Wrapper: `sticky bottom-0 -mx-4 mt-auto bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]`. Button: `btn btn-signal btn-lg w-full`, "Search" then `ArrowRightIcon size-5`. |

**Recent searches (if Q6 is yes):**
- Store them in localStorage at `sheltuh:recent-searches`: the last 5 distinct non-empty `q` values, trimmed and
  capped at 100 characters, newest first.
- Write on submit only. Never send them anywhere, and never store `near` with them (the place has its own
  storage).
- Clear empties the key.
- The Privacy Policy needs a line about local search history (a copy dependency).
- Demo and live behave the same.

**Sheet states:**
- The field is auto-focused on open.
- Location status shows under Where ("Finding your location…"; errors in `text-danger`).
- Without JS, the form still GETs `/search`.
- From `lg`, the inline bar is unchanged.

**Accessibility:**
- While open it's `role="dialog"`, named "Search events" (as now).
- Escape closes the suggestions first, then the sheet (existing). Focus returns to the trigger. Tabbing out closes
  it (existing).
- Back is a real button. The When chips use `aria-pressed`.
- Targets: back 48, field 48, Where row 64, location row 48, chips 48, Search 56.

### 5.6 Filter dropdown (`components/ui/FilterDropdown.tsx`, from `lg`)

| Board state | Current | Change |
| --- | --- | --- |
| 1 Default: outline on white | `border-foreground bg-background` | Matches. |
| 2 Hover: cream | `hover:bg-hover` | Add the twin, `focus-visible:bg-hover`. |
| 3 Open: black fill | the native list opens; the closed select keeps its look | Add `open:bg-foreground open:text-background` to the select (Tailwind v4's `open:` covers `:open` on a customizable select). Let the chevron follow (`group` on the label, `group-has-[:open]:text-background`). Where `:open` isn't supported, nothing changes. |
| 4 Active: black | `active` → `bg-foreground text-background` | Matches. |
| 5 Dark grey fill | – | **Ask Latte** (§9.2 Q3). If it's Dark's default, it's `--surface` #1f1f1f (no new token). If it's a pressed state, decide then. |
| 6 Text only, no stroke | – | **Ask Latte.** Probably "Sort" or a plain variant. Don't build it until it's named. |

Keep the height at 48. The screenshot can't tell 40 from 48.

### 5.7 Filters button (`SceneMapFilterBar.tsx` today; new on home and /events)

The board shows "Filters" with a black square count badge. Nearby already has this:
`filterChipClass(false)` + `CountBadge` (plain, foreground-filled) + `aria-label="Filters, N active"`.
- Move that exact button to a shared `FiltersButton` in `components/ui/` (moved, not rebuilt).
- Add `aria-haspopup="dialog"` and `aria-controls` pointing at the sheet.

### 5.8 Filter sheet (new; `components/ui/FilterSheet.tsx`; home's All events below `lg` first)

```
div[popover=auto][role=dialog][aria-labelledby=title]   bottom sheet: inset-x-0 bottom-0 top-auto m-0 w-full max-w-none
    max-h-4/5 flex flex-col rounded-t-sheet border-x-0 border-b-0 border-t-control border-foreground bg-background
    backdrop:bg-ink/40
  div relative flex h-16 items-center gap-2 px-4             (head)
    span aria-hidden handle  absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-surface-border  (decorative; not draggable)
    h2#title heading-h4 flex-1           "Filters"
    button label-button min-h-11 px-2    "Reset"   (name "Reset filters"; aria-disabled + text-disabled while the draft is empty)
    button size-12 aria-label="Close"    ✕          (not on the board, see below)
  div flex-1 overflow-y-auto overscroll-contain px-4
    fieldset py-6 (first) / border-t border-surface-border py-6 (rest)
      legend eyebrow text-muted          "Date" | "Price" | "Category" | "Distance"
      div mt-3 flex flex-wrap gap-2      chips
  div border-t border-surface-border bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]
    button btn btn-signal btn-lg w-full  "Show {N} events" + ArrowRightIcon size-5
    p role=status sr-only                "{N} events match" (100ms after a change, as HomeAllEvents)
```

| Section | Board | Spec | Data |
| --- | --- | --- | --- |
| Date | Tonight, Tomorrow, **This weekend** (selected), Pick dates | `FilterChip`s, single choice; pressing the selected one clears it. Pick dates is Nearby's `DateChip` (a native date field inside the chip, `showPicker()`). | Tonight and This weekend exist (`isTonight`, `isOpenThisWeekend`). **Tomorrow is new:** the event's calendar day is tomorrow in its own zone, like `isTonight`. Pick dates picks **one date** (`isOnDate`) until a range is defined (Q4). |
| Price | Free, Under A$30, A$30–80, A$80+ | `FilterChip`s, single choice | All-inclusive `getMinBuyerTotalCents`. Free is `isFreeEvent`. Band edges per Q4. An event with no price (no ticket types, or external with no price-from) matches no band. External events use `externalPriceFromCents`. |
| Category | **tiles** with icons: Live music (selected), Art, Workshops, Pop-ups | `FilterChip` with `CategoryIcon size-5` and `className="h-14"`: 56px, one step above the 48px chip (the board's tiles are ≈1.7× its chips). Content width, wrapping. **Include Theatre** (5 categories; the board leaves it out). Single choice. | existing |
| Distance | 5 km, 10 km, **25 km** (selected), 50 km+ | `FilterChip`s, single choice; none selected means any distance. **Shown only when there's a place** (the remembered suburb). Otherwise the fieldset shows one line in `body-s text-muted`: "Choose a suburb in search to filter by distance." | Client-side `lib/map-near.ts` (`NEARBY_RADII_KM` 5/10/25/50; the event's pin or its suburb's centre). "50 km+" per Q4. |

**Behaviour (proposal P2: staged filters):**
- The sheet edits a **draft**, copied from the applied filters, and the count is computed live from the draft.
- **Show** applies the draft, closes the sheet, and moves focus to the All events heading (as Reset does today).
- Close, Escape or a tap on the scrim **discards** the draft. Reset clears the draft only.
- The home's category row stays instant.

**Count label:**
- Home: "Show {N} events" (or "Show 1 event"), where N is the loaded events that match the draft, which is exactly
  what the grid will list.
- At 0 it reads "Show 0 events" and stays enabled; the empty state with Reset filters follows.
- /events (live): **"Show events"**, with no number until B5.

**Close button:** the board has none. A dialog has to be closable without a gesture or Escape, because light
dismiss isn't reliable for VoiceOver, TalkBack and switch users.

**Accessibility:**
- On open, focus goes to the first chip (not Reset). On close it returns to Filters.
- Sections are `fieldset` / `legend`. Chips use `aria-pressed`.
- Targets: chips 48, tiles 56, Close 48, Reset 44, Show 56.

### 5.9 Filters per page

| Page | Current | Target |
| --- | --- | --- |
| Home, All events (`HomeAllEvents.tsx`) | `FilterDropdown` ×3 (Price: Any / Free / Under A$25; Category; Date: Any / Tonight / This weekend), a sideways row on phones that wraps from 640, plus a Reset filters link | **Below `lg`:** `FiltersButton` and Reset filters (when any are set) on one row, then the sheet (§5.8). **From `lg`:** the `FilterDropdown` row, Date, Price, Category and **Distance** (only with a place: "Any distance", "Within 5 / 10 / 25 / 50 km"). Option labels per Q4. |
| /events (`EventFilterBar.tsx` via `LiveEventFeed` and `EventBrowser`) | the old form: a Category `<select>`, an "On or after" date field, Price radios (All / Free / Paid), and a "Filters · 2" disclosure below 640 | **Increment 6 (blocked on B2–B5):** the same button and sheet below `lg`, the same row from `lg`. Until then, unchanged. Swapping "On or after" for the Date chips is a behaviour change (P3). |
| Nearby (`SceneMapFilterBar.tsx`) | a Filters disclosure below `lg` (Tonight, This weekend, Date, Category, Price, Distance) | Out of scope. A follow-up can adopt the sheet; it has every section except Tomorrow and the price bands. |

### 5.10 Icons (`components/home/CategoryIcon.tsx`, `components/map/MapControlIcons.tsx`, `components/home/icons.tsx`, `components/checkout/icons.tsx`, inline SVGs)

**Now:** there's **no icon library** (no lucide). Every icon is a hand-made inline 24×24 outline SVG.
- They're spread over 4 files, plus inline copies in `Nav.tsx`, `SearchBar.tsx`, `LocationPicker.tsx`,
  `Footer.tsx`, `WhoSeesYou.tsx` and `JoinBanner.tsx`.
- Strokes are mixed: **1.75** in `CategoryIcon`, `WhoSeesYou` and `JoinBanner`; **2** everywhere else.
- There are duplicates: `CalendarIcon` ×2, `ChevronDownIcon` ×2, `SearchIcon` ×2 plus 2 inline copies,
  `ArrowUpRightIcon` ×2.

| Board icon (in order) | Current equivalent | Status |
| --- | --- | --- |
| Grid (4 squares) | `CategoryIcon "all"` | Matches; the stroke differs. |
| Music note | `CategoryIcon "music"` (a pair of quavers) | Close; redraw to the board. |
| Image (frame and sun) | `CategoryIcon "art"` | Matches. |
| **Pencil** | `CategoryIcon "workshop"`, a **hand holding a paintbrush** | **Different.** Replace it with the pencil; the board uses it for Workshops in the filter sheet. |
| Shop (storefront) | `CategoryIcon "pop-up"` (scalloped awning) | Close; redraw. |
| **Pocket mark** (badge with ü dots and a smile) | none (`UMark` is the logo, not an icon) | **New.** Its use isn't stated (§9.2 Q4). |
| Tag | `CategoryIcon "free"`, `MapControlIcons TagIcon` | Matches (two copies). |
| Calendar | `MapControlIcons CalendarIcon`, `home/icons CalendarIcon` | Matches; merge them. |
| Layers | `MapControlIcons LayersIcon` | Matches. |
| Tag (the second one) | – | Probably one is price and one is free; ask Latte. |
| Target (rings) | `MapControlIcons DistanceIcon` | Matches. |
| Not on the board | theatre, search, pin, chevrons, arrows, close, menu, **history** (new, for Recent), back arrow | Ask Latte for these in the same style. Keep the current ones meanwhile. |

**Change (increment 7):** create one `components/ui/icons.tsx`.
- Every icon: viewBox 24×24, `fill="none"`, `stroke="currentColor"`, **one stroke width** (Latte to confirm 1.5,
  1.75 or 2 from the SVG export), round caps and joins, `aria-hidden`.
- Re-export from the old paths, so no call site breaks, then migrate the call sites. No new dependency.

### 5.11 Footer (`components/Footer.tsx`): socials and theme toggle

| Part | Current | Figma (sign-in and Community footers, "Social icons", "Theme toggle") | Change |
| --- | --- | --- | --- |
| Wordmark, line, theme | orange wordmark; "Where is ÜR Sheltüh?"; install prompt; "Theme" eyebrow and switch | the same (Light selected on sign-in, Dark selected on Community) | Matches. |
| Theme toggle | a 1.5px-stroke group, `p-2`, 48px segments (40 from `lg`), the selected one foreground-filled with the two orange dots | black container; selected segment white with black text; no dots visible at screenshot size | Matches. Keep the dots (the system's selected mark). |
| Column heads | `eyebrow`, sentence case | mono caps | Keep (owner decision). |
| Contact icons | **mail, Instagram, TikTok, LinkedIn**; 48 (40 from `lg`), `text-muted`, hover solid orange with a black icon | **LinkedIn, Instagram, mail**, no TikTok; hover reads as a dark orange-tinted square with an orange icon | Keep TikTok (it's a real account). **Order: Instagram, TikTok, LinkedIn, mail** (socials first, as drawn). Add the twin, `focus-visible:bg-signal focus-visible:text-signal-foreground`. Keep the solid hover until Latte confirms the tint (§9.2 Q5); a tint would need a token that gives the icon at least 3:1. |
| Legal links and © | present | not in the frames | **Keep** (Privacy Act, ACL). Also fix the Legal nav's `sm:order-last`, which breaks Round 2's "DOM order = visual order": move it after the © line in the DOM. |

### 5.12 Sign-in page (`app/login/page.tsx`, `components/auth/AuthShell.tsx`, `LoginForm.tsx`, `OAuthButtons.tsx`; r2p2)

| Part | Current (r2p2) | Figma | Change |
| --- | --- | --- | --- |
| Header | "Sign in" current: dots and underline | the same | Matches. |
| Backdrop | one **licensed** photo (`AUTH_PHOTO`, hands in a record crate), full-bleed from 1024 | **two photos split 50/50**, of **identifiable people with orange smileys drawn on their faces** | Keep current (§4.4). A split is fine with two licensed photos (an asset dependency). Never use the board's photos. |
| Card | `max-w-120` (480), `lg:p-10`, `lg:rounded-card`, fits its content | ≈556 wide; fixed height with empty space below | Keep current (Round 2's sign-in fix, the owner's later handoff). |
| Wordmark, strap, title, intro | `Wordmark h-6`; `Strap` "Account" with dots; "Welcome to Sheltüh" in `heading-section-l`; "Find your place, find your people." | the same (with a mono-caps strap) | Matches. |
| Form | **Email + Password** (with "Forgot password?"), then **Continue →** (orange) | **Email only**, then Continue → | **Owner Q3.** Email-first changes the flow: a second step is needed (a password, or a one-time code or magic link). Don't build it until Q3 is answered. |
| Divider | "Or continue with" (eyebrow) between hairlines | mono caps | Matches. |
| Social buttons | **stacked**, full width, "Continue with Apple" (Apple Black) and "Continue with Google" | **side by side**, outlined, titled "Google" / "Apple" | **Keep current.** `social-sign-in.md` §5 says "Never put the buttons side by side". The titles must be the vendors' ("Continue with …"), and Apple's outlined white isn't used. Tell Latte (§9.2 Q6). |
| Legal line | the providers' line ("Continuing with … signs you in, or creates an account…") with Privacy links | "By continuing you agree to Sheltüh's Terms of Use and Privacy Policy." | Keep current until the Terms are drafted (an outstanding legal item). An "agree to" line is a legal decision. |
| Links | "New here? Create an account", "Find my tickets" | "New here? Create an account" | Matches. Keep Find my tickets. |

### 5.13 /community hero (`components/community/CommunityHero.tsx`)

| Part | Current | Figma (hero board and the Dark page) | Change |
| --- | --- | --- | --- |
| Collage band | on the page colour; two staggered rows; photos `h-28 md:h-40 lg:h-48` (112/160/192) in 4px white frames; tilts ±1–2°; gaps 16/24; `aria-hidden` | a **full-bleed black band**; two rows of **larger photos (≈240 tall at 1440) overlapping** by about 8px; ≈6px white frames; tilts ±1–3°; bleeding off both edges | Wrap the band in `data-surface="ink"` (black in both themes; the 1px rule in Dark per D7), with `py-6 md:py-8`. Photos `h-32 md:h-48 lg:h-60` (128/192/240). Rows `-space-x-2` instead of `gap-4 md:gap-6`. Keep the tilts and the second row's offset. Use **only `COMMUNITY_COLLAGE`** (§4.4). `sizes`: `(min-width: 1024px) 320px, (min-width: 768px) 256px, 171px`. |
| Eyebrow | dots + "Community" | dots + "COMMUNITY" (Dark page); dots only (hero board) | Matches the Dark page (sentence case). |
| h1 | "FIND YOÜR / PEOPLE." `display-l lg:display-xl` | the Dark page shows the same capitals, two lines. The hero board's export lost it. | Matches. |
| Lede | `body-l text-muted`, right column from 1024 | the same | Matches. |
| Buttons | Explore scenes (signal with an arrow), **md 48**; Join free **outline**, md, signed-out only | Explore scenes orange with an arrow; **Join free solid** (black in Light, white in Dark); ≈56px on the hero board | Join free → `variant="solid"`. Both → `size="lg"` (56; L is allowed in a hero). Keep `SignedOutOnly`. |

### 5.14 /community panels (`LocalDiscovery.tsx`, `WhoSeesYou.tsx`; "Word of mouth")

**Finding:** the boards' "dark panels" are the **Dark theme** of the current cream panels. `bg-hover` is cream
#fffae7 in Light and **#1a1a1a in Dark**, which is the grey the boards draw. So the panel surface already matches,
and the differences are in content and layout only. That layout is the on-hold Dark page's (§5.15).

| Panel | Current | Figma | Status |
| --- | --- | --- | --- |
| Local discovery | a `bg-hover` panel (`rounded-card`); title and line; a sideways row of `EventCard surface="cream"`; "See events on Nearby" | dark cards: purple-tinted category tag; **suburb only, in mono caps**; colour-dot avatars with "86 going"; orange "From A$67"; heart; "← SWIPE / SCROLL →" | Panel matches. **In Dark, the outlined `surface="cream"` card shows a 1.5px white stroke** that the boards don't draw: on hold, §5.15. Cards keep **date and place on two lines** (owner amendment), not suburb only. "N going" uses real thresholded counts only. |
| You choose who sees you | **replaced** on 13 Nov by the owner's "Your visibility, your choice" (three points, then "How Who's going works") | the older panel: a toggle card "Show me in Who's going", "High Note Turns 3 · Sun 15 Nov", faces, "86 going · 2 you know" | Keep current (the owner's newer decision). If it comes back: **no fake toggle**. A switch that does nothing fails WCAG 4.1.2 and misleads. Use a static `aria-hidden` illustration with real text beside it. "2 you know" needs a social graph (B7). |
| Word of mouth | not built ("waits for Batch 3", `CommunityPage.tsx`) | tilted chips: "Mia is going", "Jay saved this ★", "Luis and 3 others are going 🔥" | **Not buildable.** Saves are private ("only the caller ever sees their own favourites", `lib/api/favourites.ts`), so "Jay saved this" must never exist. Who's going names are shown only to verified members, on events the person opted into. "Luis and 3 others" needs friends (B7). The emoji are off-brand. Fictional names as marketing art would break "real data only". |

### 5.15 /community, Dark 1440: the "(on hold)" page. Reference only; a later increment

Latte marked "Community — Desktop 1440 - Dark (on hold)" **on hold**. It's recorded here as a reference for
**increment 10** and isn't part of increments 1–3. The photo caveat (§4.4) applies in full: the collage, the
Scenes by city photo (an identifiable person with a smiley) and the posters are placeholders.

Its header, hero and footer are covered in §5.1, §5.13 and §5.11, and they match or have their changes listed
there. What's specific to this page:

| Part | Current (`components/community/*`) | Figma (Dark, on hold) | Difference / what increment 10 would do |
| --- | --- | --- | --- |
| Page in Dark | follows the theme: black page, ink sections | black page | Matches. Nothing extra to build for Dark. |
| Panel grid | `lg:grid-cols-12`: Local discovery `col-span-7`, Your visibility `col-span-5`, same height | Local discovery ≈7 columns on the left; **two panels stacked on the right** (Word of mouth over You choose who sees you) | The stacked right column only exists if Word of mouth ships, and it can't (§5.14). With today's two panels, the current grid is right. |
| Local discovery cards in Dark | `surface="cream"`: `bg-card` (#141414) and a **1.5px white stroke** | **black cards, no stroke**; 2 rows of 2 (a sideways scroll, with the next card peeking in) and a "← swipe / scroll →" hint | In Dark only, drop the stroke: add `dark:border-transparent` to the cream variant. The hover (`--surface`) still shows on #1a1a1a. The current single row stays: the two-row grid is a layout preference, not a fix. Hint: §5.14. |
| Scenes by city heading | `HomeSectionHead` "Scenes by city" | dots + "Scenes by city" | Add `DotsMark size="xs" text-signal` before the title (as the hero eyebrow), `aria-hidden`. |
| Scenes by city photo | one licensed `SCENES_PHOTO`, `aspect-[5/4]`, `col-span-7`, `rounded-card`, decorative | a larger photo with a **tilted white "melbourne" sticker** (Bootzy, lower case, black on white); the photo appears to follow the **active city** | **Assets needed:** five licensed city photos (none exist; only Melbourne's). With them, the active city's photo shows. Change it on **hover and on focus** of a row, never on hover only. The photo stays decorative. The sticker is an `aria-hidden` label: `bg-paper text-ink font-display` (Bootzy, as written, lower case), `-rotate-3`, `px-4 py-2`, `rounded-control`, bottom-left, 24px in. It's a brand sticker on an opaque white label, never text on the photo. |
| City list rows | `min-h-36 py-6`, 96px thumbnails (the soonest event's EventArt), name `heading-h1`, `mono-s` meta (categories · "N upcoming") on every row, hover `bg-hover` with an underline | shorter rows (≈104px) with ≈72px thumbnails; **the active city (Melbourne) has orange dots before its name and its meta line; the others show the name only** | Active = the row hovered or focused (and Melbourne by default). Its name gets `umlaut umlaut-side pl-10` (the dots on, no underline) and its meta line shows. Other rows keep the meta in the DOM as `aria-describedby` text but visually `sr-only`, so nothing is hover-only for screen readers. Rows `min-h-26 py-4` (104), thumbnails `size-18` (72), names stay `heading-h1`. |
| Join band | the owner's 13 Nov banner: "Find your people." in an orange band; two features (See who's going; Your visibility, your choice); a black "Join Sheltüh — free →" with "Already a member? Sign in" | the proposal's band: **"Your people are already here."**, **three numbered steps** (01 Follow scenes, 02 See who's going, 03 Show up — or don't), a **white** "Join Sheltüh — free →" with a small note | **Keep the owner's 13 Nov banner.** "Follow scenes" doesn't exist: only organisers can be followed, so it can't be promised. If Q5 brings this band back, the steps become "Follow organisers / See who's going / Show up — or don't". The white button on orange is fine (white edge on orange 3.4:1, label 21:1), but the current black one is the system's "never an orange button on orange" choice. |
| Footer | Dark selected | the same | Matches. |

**Increment 10 acceptance (if Q5 says build):**
- In Dark at 1440, the Local discovery cards have no white stroke and the "Scenes by city" heading has the dots.
- With five licensed city photos: Tab or hover on Sydney swaps the photo and marks Sydney with dots, and its meta
  is visible.
- Without the photos: Melbourne's photo stays for every city.
- No photo without a `public/events/README.md` entry.

### 5.16 Header, avatar menu and drawer as built: an exact copy of the boards (19 Nov 2026)

**The owner's standing rule:** when they send reference pictures, the build is an exact copy of them: layout, sizes,
spacing, colours, icons and wording, with no "improvements". This section records the header, the avatar menu and
the phone drawer as built to that rule. **It overrides every section above for those three** (§2, §3, §4.1, §5.1,
§5.2 and §5.3) wherever they differ. Two owner decisions still override the boards: the desktop header follows the
theme (Q1), and "My tickets" links to `/help#where-are-my-tickets` (Q2).

**How it was measured.** Pixel overlays on the board images at each frame's own scale: the "Navigation" board
(1440 → 535px, 0.372), the "Menu drawer / Mobile" board (390 → 246px, 0.630) and the two 1440 × 900 Dark page
boards with the header (2000px, 1.389, de-dimmed from their modal overlay). The build was rendered in Chromium at the
same scale and fitted to the board by the least squared pixel difference, for each size, weight and offset below.
Everything listed now lands within one board pixel (0.7px on the 1440 boards, 1.6px on the drawer board, 2.7px on
the Navigation board), apart from the differences listed at the end.

**Desktop header** (`components/Nav.tsx`, `components/AuthNavLinks.tsx`, `app/globals.css`):

| Part | As built (= the board) |
| --- | --- |
| Row | **100px** (`--header-h: 6.25rem`; `h-25`, 92 once scrolled at XL, as before with 8px less). Light: white (`--header`), a **1px black** rule inside its foot. Dark: **#0a0a0a** (`--header`), a 1px `--surface-border` (#333) rule. |
| Sides | 64px left, **66px** right from 1280px (`xl:pl-16 xl:pr-16.5`); 32px from 1024. |
| Wordmark | 20px tall (88 wide), **2px above** the row's middle (`-translate-y-0.5`); the places start 34px after it (`mr-0.5` + `gap-8`). |
| Places, Sign in | `label-nav` **18/24 medium**, 32px apart, the label **1.5px below** the middle (`umlaut-nav` `translate: 0 1.5px`). Dots 20×6, 26px from the top. The current page's 2px underline **13.5px** under the baseline. |
| For organisers | `nav-button`: **171 × 43**: an 18/24 **regular** label, 8px top and bottom, 25px sides, the 1.5px stroke, radius 8, 1.5px below the middle. |
| Messages | `nav-chip`: **37px** tall, 14/20 **regular**, 16px sides, the 1.5px `--surface-border` outline; the count is an orange **24 × 16 pill** (`CountBadge shape="pill"`), 8px after the label and 2px above the middle. |
| Avatar | `nav-avatar`: 40px tall, **51 wide**: 16px sides, the initial (16px semibold), then a **6 × 4 caret** 4px after it (`gap-1`). Black in Light, white in Dark. |

**Phone bar and drawer** (`components/Nav.tsx`, `MenuAccount`):

| Part | As built (= the board) |
| --- | --- |
| Bar | **64px** (`--header-h: 4rem` below 1024; `h-16`), black in both themes. |
| Wordmark | orange, **19px** tall (`h-4.75`), 16px in, **2px above** the bar's middle. |
| Search, Menu, Close | 40 × 48 targets (`h-12 w-10`); the icons centred **68px and 28px** in from the right (`-mr-2`). **No unread count** on Menu or Close: the boards draw none. |
| Places | unchanged: `label-menu` 40/48 bold on a 72px pitch, the first line **56px under the bar** (`pt-11`), 56px from the edge; round 24×8 dots 16px in. |
| Who's signed in | a 48px circle (the photo, else the **cream circle**, `--avatar-placeholder` #fffae7, no initials); the name **20px semibold** (`text-xl`); "View profile" **14px medium**, muted. |
| Rows | My tickets, Saved, Messages: 64px, a hairline above, the label `label-nav` **18px** 12px under it. **No counts** (the board draws Latte's rows without numbers). Your events (organisers) and Admin (admins, with its waiting count) as before: the board doesn't draw them. |
| Buttons | unchanged: Sign in orange and For organisers outlined, 56px, 16px apart. |

**Avatar menu** (`components/nav/AccountMenu.tsx`):

| Part | As built (= the board) |
| --- | --- |
| Panel | **280px** (`w-70`), radius **16** (`rounded-card`), `p-2`, **no shadow** (the board draws none). Light: white (`--menu`) with a **1px `--surface-border` hairline**, no black stroke. Dark: **#1c1b17** (`--menu`) with a 1px white stroke. 8px under the header (`top-27`, `top-25` once scrolled at XL), its right edge on the avatar's. |
| Who's signed in | as before: a 40px circle (the photo, else the **cream circle**, no initials), 16px semibold name, `py-4 gap-4`. |
| Hairlines | 1px `--surface-border`, **edge to edge** across the panel (`-mx-2`). |
| Rows | **40px** (`min-h-10`), **16px semibold**, 16px in; under the pointer, on focus and pressed: `--menu-hover` (cream #fffae7 in Light, **#2e2b26** in Dark). |
| Counts | **24 × 16 pills**: Saved in the panel's other fill (cream on white, white on a hovered row; #2e2b26 in Dark), Messages orange with a black number, Admin black. |
| Log out | the board's label, "Log out". Light: **`--signal-text` #d03e00** (owner decision, 19 Nov 2026: accessibility over the board's exact colour for this one): 4.8:1 on white, 4.59:1 on the cream hover row. Dark: the board's **`--signal` #ff4800**, 5.07:1 on the panel. |

**New tokens:** `--header` (#ffffff / Dark #0a0a0a; retired 22 Nov 2026, when the header became ink), `--menu` (#ffffff / #1c1b17), `--menu-hover` (#fffae7 /
#2e2b26), and `--avatar-placeholder` (#fffae7 in every theme). `label-nav` is now 18/24 (it's only used by the nav).

**The one unavoidable difference:**
- **The identity row's second line.** The board's "@latte · 2 upcoming" has no data behind it: there's no @handle
  and no upcoming count. The line shows the member's email (`meta`, muted, sentence case), and nothing when there's
  no display name. For the same reason, **My tickets has no count** (the board's "2"): there's no tickets list
  until B1.

**What the boards don't draw, kept as it was:** hover, focus and pressed states; the loading states; the Admin header
item and the Admin and Your events rows (for admins and organisers only, so a member sees exactly the board); the
scrolled XL header (100 → 92); and the Dark phone bar's 1px rule against the black page (no board shows a Dark
phone page).

**Accessibility consequences of the exact copy** (for the owner, not changes to make):
- Log out: the board's #ff4800 is 3.4:1 on white, so Light uses #d03e00 instead (owner, 19 Nov 2026; see the table).
  In Dark, #ff4800 is 5.07:1 on the panel but **4.15:1 on the hovered or focused row** (#2e2b26), under 4.5:1.
- Phones show no unread count anywhere outside /messages: not on Menu and not in the drawer.
- Targets: the avatar menu's rows are 40px and the phone bar's buttons 40 × 48, above the 24px minimum (WCAG 2.5.8)
  but under the 44px this spec preferred.

## 6. Motion

| What | Why | How | Reduced motion |
| --- | --- | --- | --- |
| Search and filter sheets slide up from 100% to 0 | shows where the sheet came from and goes back to | 200ms ease-out, `@starting-style`, `transition-behavior: allow-discrete` | appear at once |
| Drawer and avatar menu fade | a quiet reveal; the drawer is large, so a slide would feel heavy | `opacity` 0→1, 150ms ease-out | at once |
| Chips, rows, buttons, dropdowns | state feedback | colour, 200ms ease-out (existing) | colour change only |
| Location chevron | open/closed | rotates 180°, 200ms (existing) | instant |
| Scenes by city photo swap (increment 10) | ties the photo to the city | `opacity` crossfade, 200ms ease-out | instant swap |
| Header 72→64 at XL | existing | existing | existing |
| Counts | – | **never animated**, never live-announced | – |

## 7. Increments (each ships on its own and keeps demo and live working)

After each one, run `npx next typegen`, `npx tsc --noEmit`, `npm run lint` and `npm test`. Also run
`npm run test:e2e` where a browser flow changed (increments 1, 2, 3 and 5). Do visual QA at 1440, 1280, 1024, 768,
390 and 320, in Light and Dark. Live signed-in states need the e2e `/api/*` intercepts for profile, unread and
favourites.

**1. Phone drawer and header tweaks** (frontend; `Nav.tsx`, `AuthNavLinks.tsx`, `globals.css`)
- Add `label-menu` and `umlaut-side`. The drawer places use them, with dots on the left and a 72px pitch. Remove
  the drawer's `border-t`.
- Signed out: Sign in becomes `btn-signal`, and the rule above it goes.
- Signed in: the identity block, then Saved / Messages / Your events / Admin rows (64px, with hairlines), then For
  organisers. The Account row goes.
- Compact bar: the orange wordmark replaces the ü (pending Latte, behind one constant), and Search is hidden while
  the drawer is open.
- Desktop: the signed-in "For organisers" becomes `nav-button`.

*Accept:*
- At 390, Discover, Nearby and Community are 40px Instrument Sans Bold, 72px apart, with labels 56px from the
  screen edge and orange dots left of the current one only.
- Sign in is orange, and every drawer target is at least 56px tall.
- axe is clean. Escape closes the drawer and focus returns to Menu.
- At 320 nothing overflows, at 200% text too. Demo shows the signed-out block.
- `tests/Nav.test.tsx` (`display-m`, the Sign in class) is updated, not deleted.

**2. Avatar menu** (frontend; `AuthNavLinks.tsx`, `Nav.tsx`)
- The avatar is a disclosure button with its popover outside `<header>`. Rows as in §5.2, with no My tickets, and
  Sign out in foreground.

*Accept:*
- From 1024: Tab reaches the avatar, Enter opens the menu, Tab walks the rows, and Escape closes it with focus back
  on the avatar.
- The menu is white in Light and black in Dark.
- Saved shows the real count and Messages the orange unread badge, and both are read in the link's name.
- Sign out signs out and goes home.
- Never in demo.
- At 1280, once the header has scrolled, the menu sits 8px under the 64px row.

**3. Search sheet layout** (frontend; `SearchBar.tsx`, `LocationPicker.tsx` `variant="row"`, `SearchSuggestions.tsx`, new `ArrowLeft` and `History` icons)
- The two-line trigger.
- In the sheet: back and the cream field on one row, the Where row, the "Use my location" row, and Search pinned
  to the bottom with its arrow.
- Recent searches only if Q6 says yes; otherwise ship without them.
- P1 only if the manager approves it.

*Accept:*
- At 390 the top row is 64px and the field is cream with a black stroke.
- Where shows the place and opens the location sheet. Use my location sets the suburb and announces it.
- Search sits at the bottom, above the home indicator, and stays visible while the list scrolls.
- Escape closes the suggestions, then the sheet, and focus returns to the trigger.
- No-JS still GETs /search.
- From 1024 the bar is pixel-identical to today's.

**4. When in search** (blocked on **B2**, plus a `when` param on `/search`)
- When chips, plus " · {when}" on the trigger's subline.
- `/search?when=tonight|tomorrow|weekend|YYYY-MM-DD`, filtered client-side in demo and on the server in live.

*Accept:* Tonight on /search lists only tonight's events, in demo and live. The subline says "· Tonight". Anytime
clears it.

**5. Home filter sheet** (frontend, client-side over the loaded events; `HomeAllEvents.tsx`, `lib/home-filters.ts`, new `FilterSheet`, shared `FiltersButton`)
- Below lg: the Filters button and the sheet. Date (including Tomorrow and one date), the price bands per Q4,
  Category tiles, and Distance when there's a place. Staged per P2.
- From lg: the dropdown row with Distance, and the dropdowns' focus and open states (§5.6).

*Accept:*
- At 390, Filters opens the sheet with focus on the first chip.
- Chip changes update "Show N events", and "N events match" is announced once.
- Show applies, closes and focuses the All events heading. ✕ and Escape discard. Reset clears the draft.
- Distance appears only with a remembered suburb. Prices compare all-inclusive.
- At 1024, the four dropdowns sit in one row, including Distance.

**6. /events filters** (blocked on **B2, B3, B4, B5**)
- Replace `EventFilterBar` with the same button, sheet and row, using the live params, and "Show N events" once B5
  lands.

**7. Icons and footer** (frontend; needs Latte's SVG export for the stroke)
- `components/ui/icons.tsx` with one stroke, the pencil for Workshops, and the duplicates merged behind
  re-exports.
- Footer: social order, the focus twin, and the Legal nav's DOM order.

*Accept:*
- grep finds no duplicate inline `<svg>` icons outside `components/ui/icons.tsx` (brand marks excepted).
- One stroke width across icons.
- The footer's tab order matches its visual order.

**8. /community hero** (frontend)
- The ink collage band with larger, overlapping photos. Join free solid, both buttons L.

*Accept:*
- At 1440 the band is black, edge to edge, with 240px photos. At 390 the photos are 128px and there's no sideways
  page scroll.
- Licensed photos only.
- Join free is black (white in Dark) and 56px tall.

**9. Sign-in** (blocked on owner **Q3**). Nothing to build until it's answered; the current r2p2 page already
matches the rest.

**10. /community Dark page deltas** (on hold; owner **Q5**, plus city photo assets)
- The Dark card stroke, the Scenes by city dots, and the active-city treatment and photo swap (§5.15).
- Not before Q5, and not as part of increments 1–3.

## 8. Proposals for the manager (behaviour changes)

- **P1** The phone header's Search icon opens the search sheet in place rather than going to /search. The link
  stays as the fallback.
- **P2** The filter sheet stages its choices and applies them on "Show N events", and closing it discards them.
  Today the home filters apply as you change them.
- **P3** /events replaces "On or after" with the Date chips (Tonight, Tomorrow, This weekend, Pick dates), and
  Price moves from All / Free / Paid to bands.
- **P4** `/search` gains a `when` parameter.

## 9. Dependencies and out of scope

### 9.1 Backend (`backend-database-engineer` / `software-architect`)
- **B1** A signed-in member's tickets: a list, and an upcoming count, from their orders. It's needed for "My
  tickets" (drawer and menu) and "{n} upcoming". There's no member tickets page or API today: tickets are emailed,
  and orders are read by session.
- **B2** `GET /events?onOrBefore=YYYY-MM-DD`, in each event's own zone as `onOrAfter` is. It's needed for Tonight,
  Tomorrow, This weekend and dates on live feeds. Filtering paginated pages in the browser gives short or empty
  pages, so it has to be done on the server.
- **B3** Price-band params on `GET /events`, over the **all-inclusive** cheapest on-sale price. The fee comes from
  the same `lib/fees.ts` logic, and no client value is trusted.
- **B4** Distance on `GET /events`. Today `near` is deliberately **never sent to the API**: it's a suburb only, and
  it stays in the browser. Sending a suburb and a radius is a privacy decision for the owner and the
  security-reviewer. Never send coordinates.
- **B5** A total for a filtered query (`total` in `Paginated`, or a count mode), for "Show N events" and /events'
  "N upcoming".
- **B6** None for avatars: `avatarThumbUrl` and `fetchAvatar` already exist.
- **B7** A social graph, for "you know" and "Luis and 3 others". It doesn't exist and is a privacy design in its
  own right. Batch 3.
- **Assets:** two licensed photos for a split sign-in backdrop (optional); four more licensed city photos for
  Scenes by city (increment 10); Latte's SVG exports (icons, smileys, the "melbourne" sticker style).
- **Copy and legal:** a Privacy Policy line on local recent searches (if Q6 is yes). The Terms line on sign-in waits
  for the Terms.

### 9.2 Questions for Latte (designer clarifications, not owner decisions)
1. The Messages chip in the Dark header: filled (`--surface`) or outline only?
2. The phone bar: does the orange `SHELTÜH` wordmark replace the ü mark from the Mobile (390) spec?
3. Filter dropdown states 5 (dark grey fill) and 6 (text only): which states are they?
4. Icons: what is the pocket mark (badge with ü and a smile) for, and which of the two tags is price and which is
   free? Please send SVG exports (with the stroke width), and theatre, history, back and target icons in the same
   style.
5. Social hover: a solid orange tile with a black icon (current), or a tinted tile with an orange icon?
6. Sign-in: Apple's and Google's rules don't allow side-by-side "Apple" / "Google" buttons on our page
   (`social-sign-in.md`), so the stacked "Continue with …" pair stays.

### 9.3 Out of scope
Nearby's filters (a follow-up can adopt the sheet), the event page, checkout, the dashboard and admin, and where the
theme toggle lives (footer only, unchanged).

## 10. Open questions for the owner

**Answered by the owner on 18 Nov 2026** (each as recommended, except Q1):
- **Q1, header in Light:** the desktop header **follows the theme** (white in Light, black in Dark, as both Figma
  variants show). The phone bar and drawer stay black. Built in increment 1 (§5.1); `theme-white-dark.md` D7 is
  amended. **Superseded 22 Nov 2026 (owner):** the whole header is black in both themes at every width, an ink
  section like the footer (`data-surface="ink"` on `<header>`), with a 1px #333 rule in Dark only. The avatar menu
  keeps the page's theme (`data-surface="page"`).
- **Q2, My tickets:** "My tickets" links to today's tickets page for now (Help's "Where are my tickets?"). A My
  tickets list page comes later with the My ticket work (B1).
- **Q3, email-first sign-in:** sign-in stays on one page (email and password). Increment 9 has nothing to build.
- **Q5, Community dark page:** later (increment 10).
- **Q6, recent searches:** yes, stored on the device only (§5.5), with the Privacy Policy line.
- **Distance (B4):** the distance filter is computed on the device from the saved suburb, and is never sent to the
  server. B4 is dropped; distance stays client-side (`lib/map-near.ts`), as §5.8 already proposes.
- Q4 (a) price bands and (c) Pick dates aren't answered yet; (b) follows from the distance answer only in that it's
  client-side.

The questions as asked:

1. **Q1, header in Light.** The board draws a white desktop header in Light. Today it's black in both themes
   (D7). Should the desktop header follow the theme? *Recommend:* keep it black. It's the brand's frame, and the
   phone bar and drawer are drawn black anyway.
2. **Q2, My tickets.** Build a signed-in tickets list (B1), or leave "My tickets" out of the menu and drawer?
   *Recommend:* leave it out for now and plan B1. Tickets arrive by email today.
3. **Q3, email-first sign-in.** The board shows email only, then Continue, with a password or one-time code on a
   second step. Today email and password are on one screen. Change the flow? *Recommend:* keep it for launch.
   Email-first is a separate auth change that needs a decision on codes or magic links.
4. **Q4, filter definitions.**
   - (a) Price bands **Free / Under A$30 / A$30–80 / A$80+**, all-inclusive, by the cheapest ticket. Do they
     replace "Under A$25" on the home and Nearby?
   - (b) Does "50 km+" mean "within 50 km", or "any distance"?
   - (c) Is "Pick dates" one date, or a from–to range?

   *Recommend:* (a) yes, everywhere; (b) "Within 50 km", with no chip selected meaning any distance; (c) one date
   for now.
5. **Q5, the Community dark page is marked "on hold" in Figma. Build it later, or now?** *Recommend:* later
   (increment 10). Its dark panels are already what /community shows in Dark. Its other changes need four more
   licensed city photos. Its Word of mouth panel, the "2 you know" line and "Follow scenes" need data that doesn't
   exist (private saves, no friends graph, no scene follows). Until then, keep your 13 Nov "Your visibility, your
   choice" card and "Find your people." banner.
6. **Q6, recent searches.** Keep the last 5 searches on the device only, with a Clear button? *Recommend:* yes,
   with a Privacy Policy line.
