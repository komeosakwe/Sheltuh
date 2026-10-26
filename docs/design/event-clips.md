# Event clips: a still on the card, a short silent clip on tap

Status: proposed · Owner: ui-design-director · Date: 24 Oct 2026 · Builds on [`brand-direction-one.md`](brand-direction-one.md) and [`theme-white-dark.md`](theme-white-dark.md), which win on colour, type, radius and focus. Behaviour, API and limits come from the architect's plan for event clips: the clip is optional, one per event, MP4/H.264, at most 15 s, **no audio track**, and has a required description.

**Code read:** `app/globals.css`, `components/ui/EventCard.tsx`, `components/favourites/SaveButton.tsx`, `components/seating/SeatDialog.tsx`, `components/home/{useRailAutoScroll.ts,RailItem.tsx}`, `components/EventArt.tsx`, `components/EventDetailsView.tsx`, `components/dashboard/{EventEditor,EventImageField}.tsx`, `components/admin/EventQueueItem.tsx`, `components/brand/DotsMark.tsx`, `lib/use-reduced-motion.ts`.

## 1. Principles

1. **The photo leads, and the clip is a choice.** Nothing moves or downloads until someone presses Play. Cards never autoplay or show hover previews, which keeps both motion and data use down.
2. **One control, one shape.** The play chip mirrors the Save mark (36px rounded square, 1px border, theme tokens) and sits in the opposite corner. It reads as part of the same system, not a video-site overlay.
3. **The controls are opaque.** Their contrast never depends on the photo: the fill is solid, never translucent, with no blur and no scrim. Orange is never behind or under the chip's text.
4. **Reuse the dialog.** The viewer is `SeatDialog`: a bottom sheet on phones, centred from 640px, with focus kept inside and returned on close. It's the same pattern as the seat page.
5. **Silent by rule, so nothing is labelled.** Every clip has no sound, so a "No sound" or muted badge would carry no information and add clutter. **Decision: there's no "No sound" label anywhere** (card, viewer or editor). The editor explains the rule once, in its hint.

## 2. Tokens

**No new variables in `app/globals.css`.** Everything uses existing tokens and utilities.

| Role | Classes / values | Contrast |
| --- | --- | --- |
| Chip, Light | `bg-background text-foreground border-foreground` (white, black, 1px black) | 21:1 text; the black border shows on any light photo, and the white fill on any dark one |
| Chip, Dark | the same tokens re-scoped: black fill, white text, 1px white border | 21:1; the white border separates it from black letterboxing (`EventArt` `fit="auto"`) |
| Chip hover (`@media (hover:hover)`) | `bg-foreground text-background` (inverts, as `.btn-outline`) | 21:1 |
| Chip focus | the target is `focus-visible:outline-none!` (the `!` beats the page's unlayered `:focus-visible` outline, so there's one ring, not two); the chip gets `ring-2 ring-ink ring-offset-2 ring-offset-paper` (same as Save overlay) | A constant black ring on a white gap, visible on any photo in both themes |
| Chip active | `motion-safe:scale-95`, 150ms | — |
| Duration label | Plex Mono 500, 12/16, `tabular-nums`, no tracking (`font-mono text-xs leading-4 font-medium tabular-nums`) | — |
| Hero chip label | Instrument 600, 13/16, uppercase, tracking 0.02em (the `.btn` md type) plus the mono duration | — |
| Play glyph | inline SVG `viewBox="0 0 12 12"`, path `M3 1.5v9l7.5-4.5z`, `fill="currentColor"`, `aria-hidden`; 12px on cards, 16px on the hero | Non-text, 21:1 |
| Viewer video box | `bg-ink` (constant black) `rounded-control` | — |
| Radii | chip and video box use `rounded-control` (8px); dialog `rounded-card` (from SeatDialog) | — |

- **Never use the U+25B6 "▶" character.** iOS renders it as an emoji. Always use the SVG glyph above.
- **Never put white on orange, and never orange behind the chip.** The chip is never `bg-signal`, because orange is reserved for the card's Get tickets. A generated poster with an orange background still gets the opaque white or black chip.
- **Spacing:** the card chip's inner padding is `px-2.5` (10px) with `gap-1.5` (6px). This is the one off-scale value, sized to sit beside Save's 36px mark. Everything else is on the 4/8 scale.

## 3. Grid and layout

No new grids. Placement inside existing boxes:

- **Cards** (`EventCard` `rail`, `grid`, and `wide` pairs; used by home rails and pairs, `/events`, `/search`, `/saved` and profiles via `EventResults`):
  - The chip sits bottom-left of the media, with its target at `bottom-1 left-2`. The 36px chip, centred vertically and left-aligned in a 44px target, therefore sits 8px from the media's bottom and left edges, matching Save's 8px inset top-right.
  - On a 134px phone grid card the chip is about 64px wide, leaving more than 60px clear of Save diagonally.
- **Viewer:**
  - Below 640px, it's a bottom sheet: full width, `rounded-t-card`, `p-5`, with safe-area padding.
  - From 640px, it's a centred dialog: `sm:max-w-lg` (512px) for portrait or square clips, and SeatDialog `wide` (`sm:max-w-2xl`, 672px) for landscape clips or unknown dimensions.
- **Event page hero:** the chip sits bottom-left of the hero image, aligned to the page's text edge on phones (§5.3).

## 4. Imagery

- **Card still:** unchanged. It's the event's `imageUrl`, or `EventArt`'s generated poster when there's no photo.
  - Rail 4:3, grid 1:1, pair 12:5 (at most 200px tall) from lg; hero 4:3 (at most 26svh since 26 Oct 2026, was 30svh) on phones, 3:2 from sm.
  - The chip shows on the poster fallback exactly as on a photo.
- **Clip in the viewer:** the whole frame is always shown (`object-contain` on `bg-ink`) and never cropped. Portrait, square and landscape are all letterboxed in black.
- **Video sizing:** `mx-auto block h-auto object-contain` plus an inline style from the clip's dimensions, `aspectRatio: "{w} / {h}"` and `width: min(100%, calc((80dvh - 10rem) * {w/h}))`, and the HTML `width` and `height` attributes. The box is the clip's exact shape, as wide as fits both the dialog and the height budget, and it's reserved before any bytes arrive, so the dialog doesn't jump when they do.
  - 10rem is the sheet's chrome: title row 44px, two 16px gaps, two description lines 40px, and padding.
  - So title, clip and a description of up to 2 lines fit inside 80dvh with no scrolling (the width formula keeps the height at most `80dvh - 10rem`). Longer descriptions scroll inside the dialog, which is capped at 90dvh by SeatDialog.
  - If the dimensions aren't known yet (dependency B1), use a `w-full aspect-video max-h-[calc(80dvh-10rem)]` box with the video `size-full object-contain`.
- **Poster attribute:** `poster={event.imageUrl}` when there's a photo. Omit it otherwise, and don't try to rasterise the SVG art: the black box plus the loader stands in.
- **No text on the clip** and no scrim. The title and description sit outside the video.

## 5. Components

### 5.1 `components/events/ClipPlayButton.tsx` (new), used in `EventCard`

**Anatomy:**
- A `<button type="button" data-clip-play={event.id}>` with the target classes `group/play flex min-h-11 min-w-11 items-center justify-start focus-visible:outline-none`.
- Inside it, first a visually hidden `<span class="sr-only">Play clip: {title},</span>` and a space, then the chip span: `flex h-9 items-center gap-1.5 rounded-control border px-2.5` plus the §2 colours, containing the `aria-hidden` glyph and `0:12`.

**Label and name:**
- Seconds: `s = clamp(round(durationMs / 1000), 1, 15)`.
- Visible text: `0:{ss}`, e.g. "0:12" or "0:05".
- Accessible name, from the content (no `aria-label`): "Play clip: {title}, 0:12". **Decision (Label in Name, WCAG 2.5.3):** the visible "0:12" is part of the name, so voice-control users can say what they see.
- `aria-haspopup="dialog"`.

**Placement in `EventCard`:**
- A new overlay frame placed **after the title's link and before `SaveButton` in the DOM**: `<div className="pointer-events-none absolute inset-x-0 top-0 z-10 {MEDIA[variant]} {isWide ? WIDE.media : ''}">`.
- It reuses the media's own aspect classes, so it matches the image box exactly with no measuring.
- The button inside it is `pointer-events-auto absolute bottom-1 left-2`.
- Render it only when `event.clip` exists.
- Tab order: card link → Play → Save → ticket action → By {organiser}.
- It's never inside the link, and never inside the `aria-hidden` `EventArt`.

**States:**
- Rest, hover and focus as §2.
- `ended` cards keep the chip at full colour; only the image is greyed.
- There is no disabled or loading state on the card: the viewer owns loading and errors.

**Rail copies:** `RailItem` already makes copies `aria-hidden` and sets `tabindex=-1` on everything inside, so the chip is covered automatically. A tap on a copy opens the viewer as normal.

### 5.2 `components/events/ClipViewer.tsx` (new): `ClipViewerProvider` plus `useClipViewer()`

**Mounting:**
- Mount it once in `app/layout.tsx`, beside `FavouritesProvider`, so every page that renders `EventCard` gets it. There's one dialog per page, never one inside a rail copy.
- `open({ event, trigger })` sets the clip. Rendering is `<SeatDialog open title={event.title} wide={!portrait} onClose>`.

**Body (children)**, in a `flex flex-col gap-4` column:
1. **Video box:** `relative flex justify-center overflow-hidden rounded-control bg-ink`, containing a `<video>` with:
   - `src={clip.url}`, `muted`, `playsInline`, `controls`, `controlsList="nodownload"`, `disablePictureInPicture`, no `loop`
   - `poster` per §4
   - `preload="auto"`, or `"metadata"` under reduced motion
   - `aria-label="Clip: {title}"` and `aria-describedby={descId}`
2. **Description:** `<p id={descId} className="text-sm leading-5 text-foreground break-words">{clip.description}</p>`. It's the clip's text alternative (WCAG 1.2.1), always visible, never truncated.

**Behaviour:**
- **On open,** call `video.play()` unless `usePrefersReducedMotion()` is true. With reduced motion, show the poster and native controls and wait for the user to press play.
- A rejected `play()` promise (autoplay policy) is silent: the controls remain.
- **Initial focus** is SeatDialog's default, the title.
- **Close** (the ✕ button "Close", or Escape): SeatDialog unmounts its children, which stops playback and buffering. Focus returns to the trigger.
- **Opened from a rail copy** (the trigger is inside `[data-rail-clone]`): before `showModal`, call `.focus({ preventScroll: true })` on the real card's `[data-clip-play="{id}"]` outside any copy, so focus returns to a reachable control and never to an `aria-hidden` one.
- **Rail hold:** while the viewer is open, every home rail holds still. `useRailAutoScroll` gains `held?: boolean`, read through a ref so the effect doesn't restart.
  - `shouldRun()` adds `&& !held`.
  - On release it resumes after `POINTER_RESUME_MS` (600ms).
  - It isn't a Pause: the Pause/Play button's state doesn't change.
  - `HomeRailSection` passes `held={viewer.isOpen}`.

**States:**
- **Loading:** if `canplay` hasn't fired after 300ms, overlay `DotsLoader label="Loading clip"` centred on the black box. Use `data-surface="ink"` on the overlay so the dots are white. Remove it on `canplay`. Under reduced motion the dots are static, as already built.
- **Error** (`error` event, or a 404 from an unpublished event): replace the video with `flex flex-col items-start gap-3 p-4` on `data-surface="ink"`, containing:
  - `<p role="alert" className="text-sm leading-5">This clip can’t play right now.</p>`
  - an outline sm `min-h-11` button "Try again", which remounts the video with the same `src`, and moves focus to the new video (or the dialog's title where a browser won't focus a video).
  - If focus was lost when the video went (it was on the video's controls, or a retry failed again), it goes to the new Try again, never the page's body.
  - The description stays below.
- **Empty:** not reachable, because the trigger only exists when a clip exists.

### 5.3 Event page hero (`components/EventDetailsView.tsx`)

**Wrapper:** wrap the hero `EventArt` in `<div className="relative -mx-5 sm:mx-0">` and move its classes to `aspect-[4/3] max-h-[26svh] w-full sm:aspect-[3/2] sm:max-h-none sm:rounded-card`. The box stays identical (the wrapper is the same width, `100%+2.5rem` on phones). Always wrap it, clip or not. (26svh since 26 Oct 2026, was 30svh: Save and Share on a phone's first screen.)

**Chip:** a hero-size `ClipPlayButton` (`size="hero"`) at `absolute bottom-3 left-5 sm:left-3`. On phones this lines the chip up with the page's 20px text edge.
- The target and chip are the same element: `inline-flex h-11 items-center gap-2 rounded-control border px-3.5`.
- Content: glyph 16px, then "Play clip" (button type), then the mono `0:12`.
- Same colours, focus ring and accessible name ("Play clip: {title}, 0:12") as §5.1. Here it's an `aria-label`, which contains both visible parts in order: visually hidden words between "Play clip" and its colon would be spaced apart by Chromium ("Play clip :").

**Layout shift:** none. The chip is absolutely positioned, and the clip data is in the same payload as the event, so it renders with the page. The image stays the LCP element; no video bytes load before the press.

### 5.4 Editor (`components/dashboard/EventClipField.tsx`, new, directly after `EventImageField` in `EventEditor`, organiser and admin modes)

**Layout** follows `EventImageField`: a `flex flex-col gap-3` column, then a `flex flex-col gap-4 sm:flex-row sm:items-start` row.
1. **Title:** `<p id="event-clip-title" className="eyebrow text-muted">Event clip (optional)</p>`.
2. **Preview:** `w-40 shrink-0 overflow-hidden rounded-control bg-ink`, containing a `<video controls muted playsInline preload="metadata" className="block max-h-60 w-full object-contain">`.
   - The source is a local object URL for a new pick, or the preview URL for a saved clip.
   - Empty: a `bg-surface aspect-square` box with `text-xs text-muted` "No clip yet".
3. **Actions** (`flex flex-col items-start gap-3`):
   - A hidden-but-focusable `input type=file accept="video/mp4,video/quicktime"`, with a label styled as `buttonClass("outline","sm","min-h-11")` reading "Choose a clip", or "Choose another clip" when there is one.
   - **Hint** (`text-xs text-muted max-w-sm`): "Up to 15 seconds, no sound, MP4 or MOV (H.264), up to {cap} MB. On iPhone, set Camera → Formats → Most Compatible, or export as H.264. It plays when someone taps the event’s photo."
   - When there's a clip: outline sm "Remove clip" (saved) or "Discard new clip" (pending). Afterwards focus goes to the file input.
   - **Uploads switched off** (`NEXT_PUBLIC_EVENT_CLIPS` unset): the organiser's field isn't shown. An admin editing an event that already has a clip still gets the field, without the file input, label and hint: the saved clip's preview, its description, and Remove clip (focus then goes to Undo). Only choosing a new clip is gated.
4. **Description:**
   - `<label htmlFor="event-clip-description" className="eyebrow text-muted">Describe the clip (required)</label>`
   - A textarea, `rows={3}` and `maxLength={300}`, required whenever there's a clip. Disabled while the clip is uploading or being checked (as is the rights checkbox), so an edit can't be lost.
   - Hint (12/16 muted): "What happens in it, for people who can’t see it. Shown under the clip."
   - Counter `meta text-muted`: "{n}/300".
5. **Rights:** a native checkbox, required whenever a new clip is chosen, in `flex min-h-11 items-start gap-3 text-sm`: "I own this clip or have permission to use it, including from everyone who appears in it."
6. **Progress**, shown while saving:
   - A native `<progress>` with `aria-labelledby` the status line, styled `h-1 w-full appearance-none rounded-badge bg-surface [&::-webkit-progress-value]:bg-foreground [&::-moz-progress-bar]:bg-foreground`.
   - A status line `meta` (`aria-live="polite"`) that steps through:
     - "Checking the file…" (the browser's pre-checks of a file just chosen; a save waits for them, so it never goes ahead without that clip)
     - "Uploading clip… 42%" (update it only every 10%)
     - "Checking the clip…"
     - "Clip saved."
   - Outline sm "Cancel upload" while uploading. Cancel also stops a Submit queued behind that save (nothing is uploaded again, nothing submitted); the status says "Upload cancelled. The event was saved without the new clip." and focus goes to the file input.
   - A pending pick before the first save shows "Ready to upload when you save."
   - After Remove clip: "The clip will be removed when you save." with an outline sm "Undo" (focus back on Remove clip); after the save, "Clip removed."
   - After Remove clip, a new pick, then Discard new clip: "Keeping the current clip."
   - The status line is blank while the field shows an error.

**Errors:**
- Shown as `text-sm text-danger` with `role="alert"` under the field (`#event-clip-error`, `tabIndex={-1}`: when a save's clip step fails, focus moves to it, or to the description or checkbox when they're the cause). The client pre-checks show the server's exact strings.
- When the clip step fails after the event itself saved, the editor keeps that saved record (its photo and version), the page is told as after a save, an admin's note is cleared (it's in the log with the save), and nothing is submitted or navigated to.
- **Preview:** a saved clip's signed preview URL that won't play is fetched again once (it may have expired); if it still won't, "Couldn’t load the preview". A new pick this browser can't play shows "This browser can’t preview this clip".
- `aria-invalid` goes on the description or checkbox when they're the cause.

| Cause | Copy |
| --- | --- |
| Not MP4/MOV (WebM, other) | "This file isn’t an MP4 or MOV video. Export it as MP4 (H.264) and try again." |
| HEVC | "This clip is HEVC, which many phones and browsers can’t play. Export as H.264 / Most Compatible and try again." |
| Too long | "This clip is {n} seconds. Clips can be up to 15 seconds: trim it and try again." |
| Too large (413, pre-check) | "This clip is {x} MB. Clips can be up to {cap} MB: export at 1080p or lower and try again." |
| Over 1080p | "This clip is bigger than 1080p. Export at 1080p or lower and try again." |
| Has an audio track | "Clips can’t have sound — export without audio." |
| Unreadable, fragmented, extra tracks | "We couldn’t read this clip. Export it again as MP4 (H.264) and try again." |
| Event locked (409) | "This event can’t be edited now, so the clip wasn’t added." |
| Upload expired (410) | "The upload expired. Choose the clip again." |
| Rate limit (429) | "You’ve uploaded a lot of clips today. Try again tomorrow." |
| Unavailable (503) | "Clips can’t be uploaded right now. Save without it and add it later." |
| Network drop | "The upload stopped. Check your connection and try again." plus an outline sm "Try again" button |
| No description | "Describe the clip." |
| Rights unchecked | "Confirm you have the rights to this clip." |

### 5.5 Admin review (`components/admin/EventQueueItem.tsx`)

**Clip row:** whenever the item has a clip, whatever the upload flag (a clip that exists is always reviewable), add a row under the item's details (above the actions' `border-t`):
- `eyebrow text-muted` "Clip · 0:12"
- the description, 14/20 foreground
- an outline sm `min-h-11` button "Play clip", named (`aria-label`) "Play clip: {title}, 0:12", which starts with the visible words

**Pressing Play clip:**
- It fetches the preview URL. While that's in progress the button is `busy` with the label "Loading clip…".
- Then it opens the same viewer with `src` set to the signed URL and no poster.
- On failure: `Notice tone="danger"` "Couldn’t load the clip. Try again."
- An expired session: the queue's "Your session has expired. Sign in again, then play the clip." (`AdminSessionExpired`), claiming the queue's one sign-in form as the row's other actions do; focus returns to Play clip once signed in.

The clip row sits before Approve… in tab order, so the reviewer reaches the clip first.

## 6. Motion

- **Moves:** only the clip, and only after a press. It autoplays on open, never under `prefers-reduced-motion: reduce`.
- **Chip:** colour transition at 150ms, and a press scale of 0.95, which is `motion-safe` only.
- **Cards and dialog:** no hover preview, no looping, no card animation, and no dialog animation (SeatDialog has none).
- **Rails:** the drift holds while the viewer is open and resumes 600ms after close (§5.2). A rail without a marquee (reduced motion, or a pair) is unaffected.

## 7. Dependencies and out of scope

**Backend dependencies:**
- **B1.** Add `width` and `height` (display pixels, from `tkhd`) to `clip` in `EventRecord` / `PublicEvent` / `SheltuhEvent`. These drive the dialog width (portrait or landscape) and reserve the video box; §4 has the fallback until then.
- **B2.** The admin queue item type needs `clip?: { durationMs, description }`.
- **B3.** The server returns the §5.4 strings in `fieldErrors.clip` (or `description` / `rightsConfirmed`), so the browser and the server say the same thing.
- **B4.** `{cap}` comes from `maxBytes`, an owner decision (10 or 20 MB).

**Frontend dependency:** F1, the `held` input on `useRailAutoScroll` (§5.2).

**Demo mode:**
- Cards show a chip only when sample data carries a rights-cleared clip, and none does today.
- The editor field renders only when the API is configured.

**Prices:** untouched. Cards keep their all-inclusive price lines.

**Out of scope:**
- Clips on the map, `SceneEventRow`, `HeroCollage`, `HeroThumb`, `WhatElse`, `GuideCard` and `CreatorsCard`.
- Captions/WebVTT, sound, transcoding, and hover or inline card previews.
- Sharing a clip, and `og:video`.
