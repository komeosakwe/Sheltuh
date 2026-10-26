# Theme: white foundation, plus a Light / Dark switch

Status: spec, 23 Oct 2026. It supersedes `brand-direction-one.md` §2.1 (the `--background`, `--surface`, `--surface-border`, `--accent-foreground` and `--cream` rows), §2.3 ("Light only") and §4 (the theme colour), and §11 #6 (the email wordmark export). Everything else in Brand Direction One stands.

Owner request (verbatim): "make it white all around with option to go white and dark". The owner saw screenshots with `--background` swapped from `#fffae7` to white and liked them.

## Decisions (already made, recorded here)

| # | Decision |
| --- | --- |
| D1 | **White replaces cream as the foundation everywhere:** the website, the installed app (manifest, `theme-color`, `lib/pwa/theme.ts`, `public/offline.html`) and the transactional emails. |
| D2 | **There's a theme switch with two options, Light (white) and Dark.** The default is **Light for everyone**. It doesn't follow the OS, because the owner asked for white. |
| D3 | **No "Match system" option.** It isn't clearly better: the owner described two states, and a third option adds a resolution rule plus a `matchMedia` listener for little gain. The storage format leaves room to add it later (§5.3). |
| D4 | **The choice persists per browser** (`localStorage`) and is applied **before first paint** by an inline script that sets `data-theme="dark"` on `<html>` (§5.4). |
| D5 | **Emails stay light only** (`color-scheme: light only`). They just become white. |
| D6 | **The door check-in (`[data-door]`, `DOOR_THEME_COLOR`) is unchanged.** |
| D7 | **Ink sections stay black in both themes.** In Dark they gain a 1px white rule where they meet the page. **Signal sections stay orange with black text in both themes.** |
| D8 | **The token name `--cream` is retired.** A new never-re-scoped constant, `--paper: #ffffff`, sits beside `--ink`. "Cream" survives only as a **poster-art colourway** (`#fffae7` in `lib/sample-events.ts`, `components/home/home-content.ts` and `lib/live/assign-poster.ts`). Those stay as they are: the owner approved screenshots that had cream posters, they're art rather than foundation, and changing them would need stored live posters normalised. |
| D9 | **Dark = the ink section's palette applied to the whole page**, with white instead of cream and a lighter `--surface`. It adds no new brand colours. |

## 1. Principles

1. **Black and white are interchangeable structure; orange is constant.** Every rule that says "black" in Brand Direction One means `foreground` and flips in Dark. Signal Orange, and black text on orange, never change.
2. **Elevation is a 1px `foreground` border, never a tone alone.** In Light the card is the same white as the page, so a card exists only through its border. Dark lifts the card one step (`#141414`), but the border still carries it.
3. **One markup, two themes.** Components read semantic tokens. A component may use the `dark:` variant only for **separation** (a rule where an ink section meets an ink page, an edge on black poster art). It's never used to recolour content.
4. **Some things are always light because they're scanned or mapped,** not themed. These are the QR plate, the map canvas, emails, print, Stripe's hosted pages and the offline page.
5. **No flash, no surprise.** The page paints in the stored theme on the first frame, and a first-time visitor always gets white.

## 2. Tokens (`app/globals.css`)

Hex stays lowercase, and `:root` stays the **first** block in the file. `tests/pwa-manifest.test.ts` reads the first `--background:` and `tests/brand-tokens.test.ts` parses `:root` by its leading `\n:root {`. Contrast is computed with WCAG 2.x relative luminance.

### 2.1 Light: `:root` (default)

| Token | Old | New | Notes |
| --- | --- | --- | --- |
| `--background` | `#fffae7` | **`#ffffff`** | White: the site foundation |
| `--card` | `#ffffff` | `#ffffff` (unchanged) | The same as the page. Cards, fields, sheets and dialogs are distinguished **only** by their 1px `foreground` border (all `bg-card` call sites already have one; §5.10 fixes the one that doesn't) |
| `--surface` | `#f2ecd6` | **`#f3f2ee`** | Sunken paper grey, a faint warm nod to the old cream. Used for skeletons, placeholders, disabled fills, hover and selected rows |
| `--surface-border` | `#ddd5ba` | **`#dedcd5`** | Decorative dividers only (1.37:1 on white), never a control boundary |
| `--foreground` | `#000000` | unchanged | |
| `--muted` | `#6b675e` | unchanged | 5.65:1 on white, 5.04:1 on surface |
| `--accent` / `--accent-strong` | `#000000` / `#262626` | unchanged | |
| `--accent-foreground` | `#fffae7` | **`#ffffff`** | Text on black: 21:1, or 15.13:1 on `#262626` |
| `--signal` / `--signal-foreground` | `#ff4800` / `#000000` | unchanged | |
| `--ink` | `#000000` | unchanged | Constant, never re-scoped |
| `--cream` | `#fffae7` | **deleted** | Replaced by `--paper` |
| `--paper` | — | **`#ffffff`** (new) | Constant, never re-scoped (the SaveButton's ring gap) |
| `--danger` / `--danger-foreground` | `#b3261e` / `#ffffff` | unchanged | |
| `--door-*` | | unchanged | |

In `@theme inline`, replace `--color-cream: var(--cream);` with `--color-paper: var(--paper);`.

**Light contrast**

| Pair | Ratio | Use |
| --- | --- | --- |
| Black on white / on surface `#f3f2ee` | 21.00 / 18.75 | All text |
| Muted `#6b675e` on white / on surface | 5.65 / 5.04 | Secondary text, any size |
| Danger `#b3261e` on white / on surface | 6.54 / 5.83 | Error text |
| White on black / on `#262626` (solid button, and its hover) | 21.00 / 15.13 | Button labels |
| White on danger (`.btn-danger:hover`) | 6.54 | |
| Black on orange | 6.18 | The only small-text pairing on orange |
| Orange on white / on surface | 3.40 / 3.03 | Non-text marks and display text only. The rule "never orange marks on `bg-surface`" stays |

### 2.2 Dark: `[data-theme="dark"]` on `<html>`

These values go in a new block **inside `@media screen`**, so that print always uses the Light tokens. Printed tickets must never come out white-on-white when "background graphics" is off.

```css
@media screen {
  [data-theme="dark"] {
    color-scheme: dark;
    --background: #000000;
    --card: #141414;
    --surface: #262626;
    --surface-border: #333333;
    --foreground: #ffffff;
    --muted: #a39e93;
    --accent: #ffffff;
    --accent-strong: #e0e0e0;
    --accent-foreground: #000000;
    --danger: #ff6b5e;
    --danger-foreground: #000000;
    /* --signal, --signal-foreground, --ink, --paper, --door-*: unchanged (constants) */
  }
}
```

Place this block directly after the `@media (min-width: 64rem) { :root … }` block and before the section scopes. Add the Tailwind variant, also limited to screen:

```css
@custom-variant dark {
  @media screen {
    &:where([data-theme="dark"], [data-theme="dark"] *) {
      @slot;
    }
  }
}
```

`html { color-scheme: light; }` stays as it is. Dark switches native controls, scrollbars, autofill and date pickers through the `color-scheme: dark` in the block above. **Don't** add a `<meta name="color-scheme" content="light dark">`. It would let the browser paint the canvas dark from the OS setting before CSS loads, which breaks D2.

**Dark contrast** (every text pairing)

| Pair | Ratio | Use |
| --- | --- | --- |
| White on `#000000` / `#141414` / `#262626` | 21.00 / 18.42 / 15.13 | All text on page, card, surface |
| Muted `#a39e93` on page / card / surface | 7.87 / 6.90 / 5.67 | Secondary text |
| Danger `#ff6b5e` on page / card / surface | 7.51 / 6.59 / 5.41 | Error text |
| Black on white (solid button) / on `#e0e0e0` (its hover) | 21.00 / 15.91 | Button labels |
| Black on danger (`.btn-danger:hover`) | 7.51 | |
| Black on orange (`.btn-signal`, badges, avatars) | 6.18 | Unchanged |
| Orange on black (`.btn-signal:hover`) | 6.18 | Unchanged |
| Orange on page / card / surface | 6.18 / 5.42 / 4.45 | Passes, but the Light rule still applies: **no small orange text in either theme** (the markup is shared) |
| Orange dots on a selected (white) chip | 3.40 | Non-text, ≥3:1 |
| Focus ring, white on page / card | 21.00 / 18.42 | |
| Control boundaries (1px white) | 21.00 | Fields, outline buttons, chips |
| `#333333` hairline on black | 1.66 | Decorative only |

### 2.3 Section scopes

| Scope | Change | Behaviour in Dark |
| --- | --- | --- |
| `[data-surface="ink"]` | `--foreground: #fffae7` → **`#ffffff`**; `--accent: #fffae7` → **`#ffffff`**; `--accent-strong: #ffffff` → **`#e0e0e0`** (so the hover is visible). Everything else is unchanged. | Stays black. It's identical to the Dark page, so **each ink section adds a 1px `foreground` (white) rule** where it meets the page (§5.6, §5.7, §5.8). |
| `[data-surface="signal"]` | `--accent-foreground: #fffae7` → **`#ffffff`**. **Add `--card: #ffffff; --surface: #ffffff;`** so nothing inside inherits a dark card from the theme. | Stays orange with black text. `.btn-signal` is still forbidden inside it. |
| `[data-surface="paper"]` (**new**) | The Light colour tokens exactly as in `:root` (`--background` through `--danger-foreground`), plus `color-scheme: light; background: var(--background); color: var(--foreground);`. Place it after the signal scope. | Pins a subtree to Light. Used **only** by the map canvas (§5.11). |
| `[data-door]` | None | Unchanged in both themes |

Update the comment above the scopes: "Ink and orange are sections, not themes. The page theme is Light (`:root`) or Dark (`[data-theme="dark"]`); paper pins a subtree to Light."

### 2.4 Unchanged

Type scale, spacing, radii, the no-shadows rule, motion tokens, `--header-h`, `--buybar-h` and `--seatbar-h` don't change. Update the `@theme` radius comment from "elevation is white on cream plus a 1px border" to "elevation is a 1px foreground border".

## 3. Grid and layout

No change at any breakpoint. The Dark separators below either sit inside existing boxes as outlines or add 1px rules to bars that already have slack (`scroll-padding` keeps its +0.5rem).

## 4. Imagery

- **Photos:** unchanged in both themes. No dimming, no filters, no overlay in Dark.
- **`EventArt` poster fallback** (`components/EventArt.tsx`):
  - Paper-tone posters (`#fffae7`, `#ffffff`, `#f2ecd6`, and now `#f3f2ee`) keep the 1px inset `ring-foreground` edge in **Light only**. Add `dark:hidden` to that span.
  - **New:** ink-tone posters (background `#000000`) get the same inset span in **Dark only** (`hidden dark:block`). This is a white 1px edge, so a black tile doesn't dissolve into the black page.
  - Rename `isCream` to `isPaperTone` and add `isInkTone`.
  - Poster colours themselves never change with the theme.
- **Portrait letterbox** (`fit="auto"`): it stays `var(--ink)`. In Dark the poster sits on black, which is the intent.
- **Text on images:** opaque chips and badges use tokens, so they invert but stay opaque. Contrast is unchanged (21:1).
- **Video facade** (`organisers/VideoFacade.tsx`): `bg-ink` stays black (letterbox).
- **QR** (`components/tickets/TicketQr.tsx`): unchanged. It's black on a `#ffffff` plate with `color-scheme: only light`. In Dark the white plate sits on the `#141414` stub, and the quiet zone is part of the plate.
- **Logo:** `Wordmark` and `BrandSvg` render in `currentColor`, so the nav wordmark turns white in Dark with no change. The footer wordmark stays `text-signal` on ink. The favicon, app icons and OG image (orange) are unchanged.
- **Image pipeline:** there's no backend dependency.

## 5. Components

### 5.1 `lib/pwa/theme.ts`

- `APP_THEME_COLOR = "#ffffff"`. Update the comment to "White".
- Add `DARK_THEME_COLOR = "#000000"`, which is the Dark `--background` and the black header.
- `DOOR_THEME_COLOR` is unchanged.
- `app/manifest.ts` still uses `APP_THEME_COLOR` for `theme_color` and `background_color`. The installed app's splash is white for everyone, because a manifest can't follow a runtime choice. That's accepted.

### 5.2 `app/layout.tsx`

- The `appleWebApp` comment changes from "cream header" to "white header". `statusBarStyle: "default"` is unchanged (§7).
- `<html … suppressHydrationWarning>`. The inline script changes an attribute before hydration.
- Add `<head>` with the theme script as its **first child** (§5.4).
- Mount `<ThemeSync />` once inside `<body>` (§5.5).

### 5.3 `lib/theme.ts` (new)

- `THEME_STORAGE_KEY = "sheltuh:theme"`, following the existing `sheltuh:` key style.
- `type Theme = "light" | "dark"`.
- Stored values are exactly `"light"` or `"dark"`, written when the user chooses either one. A missing or unknown value, or an exception when reading storage, means `"light"`.
- `getTheme()` reads `document.documentElement` (`data-theme="dark"` means dark; anything else means light), so it's the single source of truth after the script.
- `setTheme(theme)`:
  1. Set the attribute for dark, or **remove** it for light.
  2. Write storage inside a try/catch. If storage fails, the choice still applies for the page's life.
  3. Sync `theme-color` (§5.5).
  4. Notify subscribers.
- `subscribeTheme(callback)` is for `useSyncExternalStore`. Its server snapshot is `"light"`.
- `THEME_INIT_SCRIPT` holds the inline script source as a string, so the layout and tests share it.
- This preference is a strictly functional on-device setting. It's not personal information, so no consent is needed.

### 5.4 The no-flash script

The script is synchronous and inline, the first element in `<head>`. It's not `async` or `defer`, and not `next/script` `afterInteractive`. Its behaviour:

```js
(function () {
  try {
    if (localStorage.getItem("sheltuh:theme") !== "dark") return;
    var d = document.documentElement;
    d.setAttribute("data-theme", "dark");
    var fix = function () {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m && m.content.toLowerCase() === "#ffffff") m.content = "#000000";
    };
    fix();
    document.addEventListener("DOMContentLoaded", fix);
  } catch (e) {}
})();
```

- The page CSP is only `frame-ancestors 'none'` (`next.config.ts`), so inline scripts are allowed. If a `script-src` is ever added, it'll need this script's hash.
- The engineer should check `node_modules/next/dist/docs/` for how Next 16 wants a raw inline `<script>` in the root layout's `<head>` (see AGENTS.md).
- The server never renders `data-theme`. Light is simply "no attribute", so the SSR HTML is correct for every first-time visitor.

### 5.5 `components/theme/ThemeSync.tsx` (new, client, renders nothing)

- **`theme-color`:** on mount, on every `usePathname()` change (Next rewrites viewport metadata on navigation) and on every theme change, it does this:
  - In Dark, if `meta[name="theme-color"]` is `APP_THEME_COLOR`, it sets `DARK_THEME_COLOR`.
  - In Light, if it's `DARK_THEME_COLOR`, it sets `APP_THEME_COLOR`.
  - It never touches any other value. The door's `#0b0b0b` stays.
- **Cross-tab:** it listens for `storage` events on `THEME_STORAGE_KEY` and applies the new value (without writing it back).

### 5.6 `components/theme/ThemeSwitch.tsx` (new, client)

This mirrors the map's existing Map/List segmented toggle (`components/SceneMap.tsx` `viewButton`), so it adds no new visual vocabulary.

**Anatomy**

```
<div data-theme-switch class={className}>
  <p id={labelId} class="eyebrow text-muted">Theme</p>                    12/16 Plex Mono 500, uppercase, 0.02em
  <div role="group" aria-labelledby={labelId}
       class="mt-2 inline-flex gap-1 rounded-control border border-foreground bg-card p-1">
    <button type="button" aria-pressed={theme === "light"}>[dots] Light</button>
    <button type="button" aria-pressed={theme === "dark"}>[dots] Dark</button>
  </div>
</div>
```

- **Segment:**
  - Classes: `flex min-h-11 items-center gap-2 rounded-badge px-5 text-sm leading-5 font-semibold` (Instrument Sans 600, 14/20, sentence case).
  - Size: **44px tall at every width** (no `sm:` reduction). Each segment is about 92px wide, and the whole control is 54px tall including `p-1` and the border. It fits 280px of content at 320.
- **Selected segment:** `bg-foreground text-background`, plus `SelectedDots` (`components/ui/FilterChip.tsx`) before the label.
- **Unselected segment:** `text-foreground hover:bg-surface`. No dots.
- **Labels:** "Light" and "Dark". The labels are the accessible names, and the group's name is "Theme". There are no icons: the words are unambiguous, and the brand avoids decorative icons.
- **Visual state comes from CSS, so it's right on the first paint:**
  - Light button: `bg-foreground text-background dark:bg-transparent dark:text-foreground dark:hover:bg-surface`. Its dots wrapper is `flex dark:hidden`.
  - Dark button: `text-foreground hover:bg-surface dark:bg-foreground dark:text-background dark:hover:bg-foreground`. Its dots wrapper is `hidden dark:flex`.
  - `aria-pressed` comes from `useSyncExternalStore(subscribeTheme, getTheme, () => "light")`. Both the visual state and `aria-pressed` derive from the `<html>` attribute, so they agree after hydration.
- **Behaviour:**
  - Activating a segment calls `setTheme`. The change is instant, with no reload.
  - Activating the already-pressed segment does nothing (this isn't a toggle-off).
  - Focus stays on the activated button.
  - There's no toast and no live region: the `aria-pressed` change is announced by the button itself.
- **Keyboard:**
  - There are two Tab stops (Light, then Dark), activated with Enter or Space.
  - There's no arrow-key roving. It's a group of toggle buttons, as in the map toggle, not a radiogroup.
- **States:**
  - Hover: unselected only, `bg-surface`.
  - Focus-visible: the global 2px `foreground` outline, offset 3px. It's never orange.
  - Active: no transform (it's not a `.btn`).
  - Disabled, loading, empty: never.
  - Storage error: silent. The theme applies for the session.
- **Contrast:**
  - Light, on the page: selected 21:1, unselected 21:1.
  - Dark, on the page: selected black on white 21:1, unselected white on `#141414` 18.42:1.
  - In the footer (ink, both themes): selected 21:1, unselected white on `#141414` 18.42:1.
  - Dots: 3.40:1 on white (non-text).

**Placement** (it's not in the desktop header row, which is full; a preference that's set rarely belongs in the footer and the menu):

1. **Footer, all widths** (`components/Footer.tsx`): in the brand column (`lg:col-span-5`), directly after `<InstallPrompt />`, as `<ThemeSwitch className="mt-6" />`. The footer is ink in both themes, so the control looks identical in Light and Dark.
2. **Phone menu sheet** (`components/Nav.tsx`, below `lg`): after the "For organisers" `ButtonLink`, as `<ThemeSwitch className="mt-8" />`, before the `mt-auto` "Melbourne · Australia" line. The menu's `closeMenuOnAction` currently closes the sheet on any `a` or `button` click. **It must ignore clicks inside `[data-theme-switch]`:** the sheet stays open, and the sheet re-skinning around the user is the feedback.

### 5.7 Footer (`components/Footer.tsx`)

- Add `dark:border-t dark:border-foreground` to `<footer data-surface="ink">`. That's a 1px white rule inside the ink scope, mirroring the header's bottom rule.
- Add the switch (§5.6).

### 5.8 Event page buy bars (`components/EventDetailsView.tsx`, both `[data-buy-bar]` divs)

- Add `dark:border-t dark:border-foreground`. The bar stays ink black with a 1px white top rule, so it separates from the black page.
- The orange button, the price and the note are unchanged.

### 5.9 `components/home/CreatorsCard.tsx`

- On the `data-surface="ink"` card, add `dark:outline dark:-outline-offset-1 dark:outline-foreground`. That's a 1px inset white edge with no layout change, the same as every other card in Dark.

### 5.10 Other surfaces that need a class change

| File | Change | Why |
| --- | --- | --- |
| `components/messages/MessageList.tsx` (incoming bubble) | `bg-card` → `bg-surface` (keep `border border-surface-border`) | A white bubble on a white page with only a 1.37:1 hairline would read as loose text. Surface gives 1.13:1 tone plus the hairline. Text is 18.75:1 in Light and 15.13:1 in Dark |
| `components/seating/SeatList.tsx` (checked seat label) | Add `has-[:checked]:text-signal-foreground` beside `has-[:checked]:bg-signal` | Otherwise Dark shows a white seat number on orange (3.40:1, which fails at 14px) |
| `components/SceneMapFilterBar.tsx` (selected date chip) | `scheme-dark` → `scheme-dark dark:scheme-light` | The chip is white when selected in Dark, so the native calendar icon must be dark |
| `components/seating/SeatDialog.tsx`, `components/messages/ReportDialog.tsx`, `components/admin/SuspendOrganiserDialog.tsx` | `backdrop:bg-foreground/50` → `backdrop:bg-ink/50` | `foreground` would wash the page white in Dark. Black at 50% in both themes; the dialog's 1px `foreground` border separates it |
| `components/QuickBuyLink.tsx` | Remove `focus-visible:outline-ink` (use the global `foreground` ring) | A black ring is invisible on the Dark page. The global ring is black in Light and white in Dark, and never orange |
| `components/favourites/SaveButton.tsx` (overlay) | `group-focus-visible/save:ring-offset-cream` → `group-focus-visible/save:ring-offset-paper`. Keep `ring-ink` | A constant black ring on a white gap, readable on any photo in both themes |
| `components/ui/Button.tsx` | Comment only: "soft cream fill" → "soft surface fill" | |

**Hard-coded values that stay fixed (they're correct in both themes):**

- `components/tickets/TicketQr.tsx` (`#ffffff` / `#000000`)
- `components/tickets/TicketStub.tsx` (`print:text-black`)
- `components/check-in/UndoCheckInDialog.tsx` (`backdrop:bg-black/80`, door only)
- `components/organisers/VideoFacade.tsx` (`bg-ink`)
- `components/EventArt.tsx`: `var(--ink)` letterbox, `fill="#ffffff"` 8% letter watermark, poster hexes
- `app/opengraph-image.tsx`
- `lib/image.ts` (`#ffffff` JPEG flatten)
- `lib/ticket-qr.ts`
- Poster colourways in `lib/sample-events.ts`, `components/home/home-content.ts` and `lib/live/assign-poster.ts` (D8)

**Already token-driven, with no change (they invert correctly):** nav, menu sheet, fields, `.btn*`, chips, `StatusBadge`, `InitialsAvatar`, `FavouritesNotice` (an inverse band: white in Dark, which separates it from the page; its "Couldn't …" text carries errors, so the 2px danger rule isn't the only signal), analytics bars, the seat map and editor (`fill-card`, `fill-foreground` and `stroke-*` tokens), the skip link, `DemoBanner` and `DemoNotice`.

### 5.11 Map (`components/SceneMapPanel.tsx`)

- Put `data-surface="paper"` on the panel's root `div` (the one with `relative isolate …`).
- The Esri Light Gray tiles stay as they are, so the canvas and everything drawn on it stay Light in both themes: markers, cluster badges, tooltips, zoom controls, attribution, `MapSpotList`, the loader and the "couldn't load" state.
- The list column and `SceneMapEventCard` follow the page theme.

### 5.12 Emails (`lib/server/email-layout.ts`, `ticket-email.ts`, `waitlist-email.ts`, `scripts/render-email-wordmark.ts`)

`EMAIL_COLOURS` becomes:

| Key | Value | Role |
| --- | --- | --- |
| `page` (renamed from `cream`) | `#ffffff` | Body and outer table `bgcolor` |
| `card` | `#ffffff` | The card. It's distinguished by its existing 1px black border and 12px radius |
| `ink` | `#000000` | Unchanged |
| `muted` | `#6b675e` | 5.65:1 on white, 5.04:1 on surface |
| `line` | `#dedcd5` | Decorative dividers (was `#ddd5ba`) |
| `surface` (new) | `#f3f2ee` | The backup and entry-code tile in `ticket-email.ts` (was `CREAM`). Black on it is 18.75:1 |
| `signal` | `#ff4800` | Unchanged; the one button |

- **Exports:** `CREAM` becomes `PAGE`, and `SURFACE` is added.
- **`page()`:**
  - Every `CREAM` becomes `PAGE`.
  - **Remove the `color:` declaration from the hidden preheader `div`.** It's already `display:none`, `max-height:0`, `opacity:0` and `mso-hide:all`. With a white page that colour would be `#ffffff` and trip the "no white text" rule.
  - Keep `<meta name="color-scheme" content="light only">`.
- **`ticket-email.ts`:** the code tile's `bgcolor` and `background-color` become `SURFACE`. Comments change from "cream page" to "white page".
- **Wordmark PNG** (`public/brand/sheltuh-wordmark-email.png`, `lib/server/email-wordmark.ts`):
  - Re-render it with `scripts/render-email-wordmark.ts`, using `PAGE` for the background. The result is **black on opaque white**, 212×48 shown at 106×24, under 16 KB.
  - It's opaque, not transparent: Gmail and Outlook dark modes can darken the page, and a transparent black mark would vanish. A white plate keeps it legible, which is the script's existing rationale.
  - Update the script and module comments ("Black on White").

### 5.13 `public/offline.html` and `public/sw.js`

- In `offline.html`:
  - `<meta name="theme-color" content="#ffffff">`
  - `--background: #ffffff`
  - `--surface: #f3f2ee`
- It stays **Light only**: the page has no JavaScript by design, and it's shown rarely.
- `sw.js`: `VERSION = "v4"`, with the comment "v4: offline.html white foundation". Add the new sha256 to `SHIPPED` in `tests/service-worker.test.ts`.

### 5.14 Stripe redirect pages

- Our `/checkout/success`, `/checkout/cancelled` and `/checkout/confirm` pages follow the theme through tokens.
- Stripe's hosted Checkout and Connect onboarding stay light and are outside the repo. That's an owner action (§7).

## 6. Motion

- The theme change is an **instant swap**. Don't add a page-wide colour transition, which would animate every element and cost paint on large pages.
- The existing 150ms `.btn` colour transition may play during the swap. That's acceptable, so no suppression hack.
- Reduced motion: nothing to handle. The swap has no motion, and no new animation is added.

## 7. Dependencies and out of scope

- **Owner action (Stripe Dashboard, not code):** under Settings → Branding, set the background to `#ffffff` and keep the button and accent colour `#000000`. These are hosted pages and can't follow the theme.
- **iOS installed app:** `statusBarStyle: "default"` is read at launch and can't follow a runtime theme. In Dark, iOS may show a light status-bar strip above the black header. Verify on a device; if it does, accept it for v1. Don't switch to `black-translucent`, which would break Light.
- **Android installed app and Chrome:** dynamic `theme-color` is honoured, handled by §5.4 and §5.5.
- **Manifest splash:** white for everyone (§5.1).
- **Out of scope:**
  - The "Match system" option (D3).
  - Dark Esri tiles.
  - Dark emails.
  - A dark offline page.
  - Changing poster colourways (D8). If the owner later wants white posters: swap `#fffae7` → `#ffffff` in the three data files, and map stored `#fffae7` to `#ffffff` inside `EventArt` at render time (no migration).
- **Docs to update with the change** (the engineer may edit docs; this spec can't):
  - `docs/design/brand-direction-one.md` §2.1, §2.2, §2.3, §4 and §11 #6 (point each to this file)
  - `docs/design-system.md` line 11 (colour) and line 60
  - `docs/pwa.md` line 16 (`#ffffff`)
  - `docs/architecture.md` lines ~258, ~284 and ~589 (email: white page)

## 8. Tests the engineer must update or add

**Update:**

| File | Change |
| --- | --- |
| `tests/brand-tokens.test.ts` | `:root` `--background: #ffffff;`. First `--background` is `#ffffff`, and `APP_THEME_COLOR` is `#ffffff`. Ink `--foreground: #ffffff;`. In the `@theme` list, `"cream"` → `"paper"`. Add a check that `css` has no `--cream`. Keep the lowercase-hex and `:root`-first checks |
| `tests/pwa-manifest.test.ts` | No edit expected: it reads the first `--background` generically. It must still pass |
| `tests/server/email-brand.test.ts` | `EMAIL_COLOURS.cream` → `EMAIL_COLOURS.page`. The allowed-colour set now includes `surface`. The "no white text" assertion stays exactly as it is (the preheader colour is removed, not exempted) |
| `tests/server/ticket-email.test.ts` | `BRAND.cream` → `page: "#ffffff"`. Line 80: `bgcolor="#ffffff"` page background. Line 105: `<body bgcolor="#ffffff"`. Add: the code tile uses `#f3f2ee`. Update the line 353 comment. The PNG byte-match and size tests pass once the PNG is regenerated |
| `tests/SaveButton.test.tsx` (lines 228, 237) | `ring-offset-cream` → `ring-offset-paper` |
| `tests/EventCard.test.tsx` (line 407) | Replace with: the CTA has **no** `focus-visible:outline-ink` and no `outline-signal` class (it uses the global foreground ring) |
| `tests/service-worker.test.ts` | Add `v4: <sha256 of the new offline.html>` |
| `e2e/pwa.spec.ts` (line 27) | `theme-color` is `#ffffff` |
| `tests/door-tokens.test.ts`, `tests/TicketQr.test.tsx` | No change; they must still pass |

**Add:**

1. **`tests/brand-tokens.test.ts` (dark and paper):**
   - The `@media screen { [data-theme="dark"] { … } }` block contains the §2.2 values and `color-scheme: dark;`.
   - The `[data-surface="paper"]` block's colour tokens equal `:root`'s, token for token.
   - The signal scope defines `--card` and `--surface`.
   - `@custom-variant dark` exists.
2. **`tests/theme.test.ts`:** run `THEME_INIT_SCRIPT` in jsdom:
   - Stored `"dark"` sets `data-theme="dark"` and flips a `#ffffff` theme-color meta to `#000000`.
   - Stored `"light"`, a missing value, `"purple"` or a throwing `localStorage` leaves no attribute.
   - A `#0b0b0b` meta is never touched.
   - `setTheme` writes `sheltuh:theme`, toggles the attribute and syncs the meta.
3. **`tests/ThemeSwitch.test.tsx`:**
   - There's a group named "Theme" with buttons "Light" (pressed by default) and "Dark".
   - Clicking Dark sets `aria-pressed`, the `<html>` attribute and storage.
   - Clicking the pressed button is a no-op.
   - Both buttons are at least `min-h-11`.
4. **`tests/Nav.test.tsx`:** the phone menu contains the Theme group, and activating it doesn't close the menu.
5. **`tests/EventArt.test.tsx`:**
   - A `#000000` poster renders the edge span with `hidden dark:block`.
   - A paper-tone poster's span has `dark:hidden`.
6. **`e2e/theme.spec.ts`:**
   - With `localStorage["sheltuh:theme"]="dark"` set via `addInitScript`, the server HTML of `/` has the theme script as the first element of `<head>`.
   - After load, `html[data-theme="dark"]` is set and the body background is `rgb(0, 0, 0)`.
   - Choosing Light in the footer and reloading stays Light.
   - At 375px, choosing Dark in the menu keeps the menu open.
   - A first visit with an OS dark preference (`colorScheme: "dark"`) still renders white.

## 9. Files the engineer will touch

- **CSS, layout, theme:**
  - `app/globals.css`
  - `app/layout.tsx`
  - `lib/pwa/theme.ts`
  - `lib/theme.ts` (new)
  - `components/theme/ThemeSync.tsx` (new)
  - `components/theme/ThemeSwitch.tsx` (new)
- **Components:**
  - `components/Footer.tsx`
  - `components/Nav.tsx`
  - `components/EventDetailsView.tsx`
  - `components/home/CreatorsCard.tsx`
  - `components/EventArt.tsx`
  - `components/SceneMapPanel.tsx`
  - `components/SceneMapFilterBar.tsx`
  - `components/messages/MessageList.tsx`
  - `components/seating/SeatList.tsx`
  - `components/seating/SeatDialog.tsx`
  - `components/messages/ReportDialog.tsx`
  - `components/admin/SuspendOrganiserDialog.tsx`
  - `components/QuickBuyLink.tsx`
  - `components/favourites/SaveButton.tsx`
  - `components/ui/Button.tsx` (comment)
- **Email:**
  - `lib/server/email-layout.ts`
  - `lib/server/ticket-email.ts`
  - `lib/server/waitlist-email.ts` (comment)
  - `scripts/render-email-wordmark.ts`
  - Regenerated: `public/brand/sheltuh-wordmark-email.png` and `lib/server/email-wordmark.ts`
- **PWA:**
  - `public/offline.html`
  - `public/sw.js`
- **Tests:** everything in §8.
- **Docs:** everything in §7.
