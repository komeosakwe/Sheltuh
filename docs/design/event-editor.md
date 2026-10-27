# Event editor: steps, section cards, sticky bar and live preview

Status: proposed · Owner: ui-design-director · Date: 27 Oct 2026 · Builds on [`brand-direction-one.md`](brand-direction-one.md), [`theme-white-dark.md`](theme-white-dark.md) and [`event-clips.md`](event-clips.md), which win on colour, type, radius, focus and the clip field's behaviour.

**Reference:** the owner's screenshot of a ticketing tool's "Build event page" screen. What we borrow is structure and polish: a left step rail with an event summary card and a status, stacked section cards, one decision per card, and a live phone preview on the right. We don't borrow its colours, type, iconography, copy, upsell cards or "New" badges.

**Code read** (from `origin/main` 085cad1): `app/globals.css`, `tests/brand-tokens.test.ts`, `components/dashboard/{EventEditor,EventImageField,EventClipField,EditEventPageContent,NewEventPageContent,OrganiserShell,VenueLocationField}.tsx`, `components/EventDetailsView.tsx`, `components/EventArt.tsx`, `components/ui/{Field,Button,Section,StatusBadge,stepper}.ts(x)`, `lib/live/adapt.ts`, `lib/organiser-events.ts`, `lib/types.ts`, `lib/api/events.ts`, `lib/csp.ts`, `next.config.ts`, `app/layout.tsx`.

**Hard constraint: no behaviour change.** Every field, id, validation message, focus rule, `aria-*` wiring and API call in `EventEditor` stays exactly as it is. This spec changes layout, grouping, hierarchy and adds a preview. Anything that would need a new field or endpoint is listed in section 7.1 and is **not designed in**.

## 1. Principles

1. **One form, three views.** The steps (Event page, Tickets, Publish) only decide which cards are visible. There is still one `<form>`, one state, one Save, one set of control ids. Nothing is saved or validated "per step".
2. **The page leads; the form follows.** The media card is first and holds the photo and the clip at equal weight. The preview shows the real event page rendering the draft, not a mock-up.
3. **Flat, ruled, quiet.** A 1px `foreground` border carries every card. No shadows, no pills, no gradients. Cards are `rounded-card` (12px), the controls and media inside them `rounded-control` (8px), badges `rounded-badge` (4px). There is a deliberate step down in radius with each nesting level.
4. **State is words and shape, never colour alone.** Current step, complete step, error count and event status each carry a word or a glyph as well as any colour. Orange is not used in the editor (it is "the one conversion CTA", never in forms or dashboards).
5. **Errors are findable three ways.** Inline under the field (today's behaviour), a summary at the top that jumps to each field (new), and focus moves to the first bad field after a failed save (today's behaviour, now also switching to the right step).
6. **Price honesty.** Wherever a ticket price appears (ticket rows, the summary card, the preview) it is the all-inclusive amount the buyer pays, from `lib/fees.ts`.

## 2. Tokens

### 2.1 Colour

**No new colour tokens and no changes to `:root`, `[data-theme="dark"]` or the scopes.** Everything uses the semantic classes (`bg-background`, `bg-card`, `bg-surface`, `border-foreground`, `border-surface-border`, `text-foreground`, `text-muted`, `text-danger`), so Light and Dark both work with no `dark:` overrides.

| Role | Classes | Light contrast | Dark contrast |
| --- | --- | --- | --- |
| Section card | `bg-card border border-foreground` | border 21:1 on page | border 21:1 on page |
| Card title, field text | `text-foreground` on `bg-card` | 21:1 | 21:1 |
| Helper, hints, meta | `text-muted` on `bg-card` | 5.65:1 | 6.90:1 |
| Helper on `bg-surface` | `text-muted` on `bg-surface` | 5.04:1 | 5.67:1 |
| Inline error, error summary | `text-danger` (text) / `border-danger` (rule) on `bg-card` | 6.54:1 (computed from `#b3261e`) | 7.51:1 on black; higher on card |
| Current step marker | `bg-foreground text-background` | 21:1 | 21:1 |
| Decorative dividers inside a card | `border-surface-border` | decorative only (never a control edge) | decorative only |
| Disabled / busy button | `.btn[aria-disabled]` (existing) | existing | existing |

Rules: no `text-signal`, no `bg-signal`, no `.btn-signal` anywhere in the editor. `surface-border` is only ever a divider between rows inside a card, never the edge of an input, card or button (the field and card edges are `foreground`).

### 2.2 New variable (the only change to `app/globals.css`)

```css
/* in :root, beside --buybar-h */
--editbar-h: 4rem; /* 64px sticky save bar on the event editor, before the safe area */
```

Add the matching scroll rule beside the `[data-buy-bar]` one, for **all** widths (the bar is sticky at every width), so a focused field is never hidden under the bar (WCAG 2.4.11):

```css
html:has([data-edit-bar]) {
  scroll-padding-bottom: calc(var(--editbar-h) + env(safe-area-inset-bottom) + 0.5rem);
}
```

`tests/brand-tokens.test.ts` pins colour values, `--radius-*`, and bans `box-shadow:` and `border-radius: 9999px` in the CSS. None of this touches those. Don't add a `shadow-*` class or `rounded-full` (only native radios and checkboxes may be round) in any new file.

### 2.3 Type scale (role to utility)

| Role | Utility / classes | Family, size/line-height, tracking, case, weight |
| --- | --- | --- |
| Page h1 (existing `PageHeader size="md"`) | `display-md` | Instrument Sans, 20/24, 22/28 from sm, 24/30 from lg, -0.02em, sentence case, 700 |
| Step title (h2, one per step) | `display-md` | as above |
| Card title (h3, or the child's `legend`) | `font-heading text-lg leading-6` | Instrument Sans 18/24, -0.025em, sentence case, 700 |
| Card helper line | `text-sm leading-5 text-muted` | Instrument Sans 14/20, 400, max `max-w-prose` |
| Field label | `eyebrow text-muted` (existing) | IBM Plex Mono 12/16, 0.02em, uppercase, 500 |
| Field text | `fieldClass` (existing) | 16px on phones, 14px from sm, `min-h-12` / `sm:min-h-10` |
| Hint under a field | `text-xs leading-4 text-muted` (existing) | 12/16 |
| Inline error | `text-sm text-danger` (existing) | 14/20 |
| Rail step label | `text-sm leading-5 font-semibold` | 14/20, 600 |
| Rail step description | `text-xs leading-4 text-muted` | 12/16 |
| Step marker numeral, "Step 1 of 3", "Last saved" | `meta` | IBM Plex Mono 12/16, 400, as written |
| Summary card title | `text-base leading-6 font-semibold` | 16/24, 600, `break-words`, `line-clamp-3` |
| Status badge | `StatusBadge` (existing) | mono caps on a 4px rounded square |
| Bar and in-card buttons | `.btn` / `.btn-sm` (existing) | 13px / 12px, 600, 0.02em, uppercase |

`SECTION_TITLE` in `EventEditor.tsx` (passed to `SeatingChoiceField` and `RefundPolicyField` as `legendClassName`) becomes `"font-heading text-lg leading-6 text-foreground"`. Its comment claims uppercase, but the heading base rule in `globals.css` no longer uppercases, so this is a documentation fix as much as a size change. `uppercase` is not added back.

### 2.4 Spacing (4/8 scale; no off-scale values in this spec)

| Where | Value |
| --- | --- |
| Page gutters | existing `Page`: `px-5 sm:px-8`, `py-8 sm:py-12` (`padding="subNav"`) |
| Shell columns gap (rail, main, preview) | `gap-8` (32px) |
| Between cards | `gap-4` (16px), `sm:gap-6` (24px) |
| Card padding | `p-4` (16px), `sm:p-5` (20px) |
| Card header to body | `gap-4` (16px) |
| Between fields inside a card | `gap-5` (20px) (matches the existing venue grid) |
| Label to control | `gap-1` (4px) (existing) |
| Divider blocks inside a card | `border-t border-surface-border pt-5 mt-5` |
| Sticky bar | `min-h-16` (64px, `--editbar-h`), `px-5 sm:px-8`, `py-2`, bottom `pb-[calc(0.5rem+env(safe-area-inset-bottom))]` (the buy bar's own pattern) |
| Rail summary card | `p-4`; steps list `gap-1` |

### 2.5 Borders and radii

`rounded-card` for section cards, the rail summary card and the phone frame. `rounded-control` for media frames, inputs, buttons, step markers. `rounded-badge` for status and count badges. All borders are 1px, except the error notice's `border-l-2` (the existing `Notice` pattern) and the current-step top rule on the phone stepper (`border-t-2`).

## 3. Grid and layout

Mobile-first. The editor shell is a new wrapper around the existing form; the page header, `BackLink` and `OrganiserSubNav` above it are unchanged.

| Width | Layout |
| --- | --- |
| 320 and 375 (default, to 639) | One column. Order: compact summary row, "Step n of 3" row with the Preview button, phone stepper, notices, the step's title and cards, then the sticky bar. Card inner width 288px (320) / 335px (375). |
| 640 to 1023 (this includes 768) | Still one column; main column `max-w-2xl` (672px) left-aligned in the page's 704px at 768. Two-column field grids, media rows side by side. Stepper shows each step's description. |
| 1024 to 1279 | Two columns: rail `w-52` (208px) + main (`min-w-0 flex-1`, `max-w-3xl` = 768px). The Preview button still opens a sheet. |
| 1280 and up | Three columns: rail `w-52` (208px), main (`min-w-0 flex-1 max-w-3xl`), preview panel `w-88` (352px). At exactly 1280 the main column is 1216 - 208 - 352 - 64 = **592px** (card inner width 552px). With the preview hidden it is 768px max. |

The shell is `mx-auto max-w-7xl` (1280px). The two pages that host the editor change their wrapper to match: `app/dashboard/new/page.tsx` drops its `max-w-2xl` and uses `<Page width="full" padding="subNav" className="max-w-7xl">`, and the edit page does the same. The header and `BackLink` keep the page's left edge.

Flex, not a grid with arbitrary templates: `lg:flex lg:items-start lg:gap-8`, rail `lg:sticky lg:top-24 lg:w-52 lg:shrink-0` (the event page's aside uses the same `lg:top-24`), main `min-w-0 flex-1`, preview `hidden xl:block xl:sticky xl:top-24 xl:w-88 xl:shrink-0`.

Desktop sketch at 1280 (not to scale):

```
 Back to your events
 EDIT EVENT
 +-------------+ +----------------------------------+ +---------------+
 | [photo 3:2] | | Build your event page            | | PREVIEW  Hide |
 | Untitled    | | intro line                       | | +-----------+ |
 | Sat 8 Nov   | | +------------------------------+ | | | live event| |
 | [DRAFT]     | | | Photo and clip               | | | | page at   | |
 | Saved 2:14  | | |  [3:2 photo]   [3:2 clip]    | | | | 320px     | |
 |             | | +------------------------------+ | | |           | |
 | 1 Event page| | | Event details                | | | |           | |
 | 2 Tickets   | | +------------------------------+ | | +-----------+ |
 | 3 Publish   | | | Venue                        | | +---------------+
 |             | | +------------------------------+ |
 |             | | | Date and time                | |
 +-------------+ | +------------------------------+ |
                 +----------------------------------+
 ==== sticky bar: Saved 2:14 pm ................ [SAVE DRAFT] [NEXT] ====
```

## 4. Imagery

| Context | Ratio and crop | Notes |
| --- | --- | --- |
| Photo frame in the media card | `aspect-[3/2]` at every width, `rounded-control`, rendered by **`EventArt` with `fit="auto"`** (the same call the event page makes) | So the owner sees the real crop: a landscape photo fills, a portrait or square one is letterboxed on black, exactly as the event page hero does on sm and up. The phone hero is 4:3 capped at 24svh; the caption below says so. Focal point is centre (no stored crop; see 7.1). |
| Clip frame | `aspect-[3/2]`, `rounded-control`, `bg-ink`, video `object-contain` | Always the whole frame, letterboxed, as in the clip viewer (`event-clips.md` §4). Empty state: `bg-surface` with `text-xs text-muted` "No clip yet". |
| Rail summary thumbnail (lg and up) | `aspect-[3/2]`, full card inner width (176px) | `EventArt`, same props. |
| Compact summary thumbnail (below lg) | `aspect-square size-12` (48px) | `EventArt`. |
| Preview | whatever the real page renders (4:3 capped hero at phone width) | Reuses `EventDetailsView`. |

**Text on image:** none. No label, badge, scrim or button sits on a photo, a clip or poster art in the editor. Replace, Remove, Discard and Choose buttons are always below or beside the frame, never on it.

**No-image fallback (required):** with no photo (new event, or photo removed) every one of these frames shows `EventArt`'s generated poster (`poster={assignPoster(slug or eventId or "new")}`, from `lib/live/assign-poster`), exactly as the public card does. A `text-xs text-muted` caption under the photo frame reads "No photo yet" (existing string, kept) and, new, "Your event shows generated artwork until you add one." The existing hint ("A square or portrait poster or photo works best...") is kept verbatim, but see 7.4 (it now sits beside a 3:2 frame and the owner may want to reword it).

The photo preview URL (object URL for a new pick, the owner-token-fetched blob for a saved draft) is currently private to `EventImageField`. It needs to be lifted so the frame, the rail summary and the preview all use one URL (7.2).

## 5. Components

Proposed new files live in `components/dashboard/editor/`; changed files are the existing ones. All new components are client components.

### 5.0 The step model

- Steps: `1 Event page`, `2 Tickets`, `3 Publish`. State: `step: 1 | 2 | 3` in `EventEditor` (view state only). Default 1. It isn't in the URL (proposal in 7.5).
- **All three panels stay mounted in the one `<form>`.** The inactive panels get the `hidden` attribute. This keeps typed text, the pending photo, the clip draft and file inputs when you move between steps.
- Switching step: set `step`, scroll the step title into view (`scrollIntoView({ block: "start" })`; the page's `scroll-padding-top` already clears the header), and move focus to the step's h2 (`tabIndex={-1}`, no ring: `focus:outline-none!`, as `PageHeader`'s `titleRef`). It announces the step. Don't use `role="tablist"`: these are step buttons, not tabs (no arrow-key model is promised).
- **Focus-on-error must switch step first.** Everywhere the code sets `focusInvalidId.current`, set `step` in the same handler, so the target is un-hidden by the time the post-render `useEffect` focuses it. The mapping (existing ids, unchanged):

| Step | Control ids and keys |
| --- | --- |
| 1 Event page | `organiserId`, `title`, `description`, `category`, `venueName`, `venueAddress`, `VENUE_SUBURB_ID`, `VENUE_TIME_ZONE_ID`, `VENUE_LOCATION_ID`, `start-date`, `start-time`, `end-date`, `end-time`, `event-image`, `event-clip` (and its description and rights controls) |
| 2 Tickets | `ticketingMode`, `externalTicketUrl`, seating choice, `add-ticket-type`, `ticket-{i}-name`, `ticket-{i}-price`, `ticket-{i}-fee-policy`, `ticket-{i}-qty`, `refundPolicy` choice, `refundDays` |
| 3 Publish | `admin-reason`, the publish checkbox, `publish-open`, `publish-confirm`, `publish-refusal`, `publish-outcome`, `publish-payouts-error`, `publish-payouts-hint` |

  Same for the refund focus (`focusRefund`, step 2), `refuseWithoutPin` (step 1) and the publish refusal (step 3: `focusPublish`). `invalidControlIds` keeps its order, so the first error is the first on screen (step 1 before step 2).
- Step completion (a derived marker, never a gate): step 1 is **complete** when title, description, venue name, venue address, suburb, start, end are non-empty and the venue has a confirmed pin (`venueLocation.hasPin`); step 2 when it is external, or every ticket type has a name, a valid price and a quantity of at least 1, and the refund days are valid when chosen; step 3 has no completion. These come from one pure `draftProblems(...)` helper that `buildInput` also calls (7.2), so the two can't disagree. It never sets `errors` and never blocks anything.

### 5.1 `components/dashboard/EventEditor.tsx` (restructured, not rewritten)

The form keeps `noValidate`, `onSubmit={handleSave}`, `formRef`, every state variable and every handler. The JSX is regrouped into the shell below. Order of the rendered regions:

1. `EditorSummary` + `StepNav` (the rail, or the compact row and stepper).
2. **Notices slot** at the top of the main column, rendered on every step, in this order: Sheltüh's note (rejected / unpublished) block, admin conflict block, session-expired block (with `InlineReauth`), `submitError` paragraph, the `role="status"` line, then the `ErrorSummary`. These blocks keep their existing markup and roles; only their position changes (from "above the buttons" to "top of the column", so they are visible when the user is scrolled anywhere). The bar's `Save` button still owns `saveRef`, so `InlineReauth`'s `saveRef.current?.focus()` still lands on it.
3. Step title + intro + the step's cards.
4. `EditorBar` (sticky).
5. `PreviewPanel` (xl+) in the third column; the `Preview` sheet for below xl.

**Locked and outcome views (organiser, `pending_review` or `published`, and after a publish).** Today these replace the form with a bare message. New: the same shell without the stepper and bar: the summary card (rail on lg+, compact row below) with the status badge, then in the main column a single `rounded-card border border-foreground bg-card p-4 sm:p-5` card holding the existing heading ("Published" / "Waiting for review", `font-heading text-xl`) and the existing sentence ("This event can't be edited while it's published / waiting for review."), and for the publish outcome the existing `PublishOutcomeView` content (title, text, **View your event page** `ButtonLink`, the contact line), keeping its id, `tabIndex={-1}`, `role="group"`, `aria-labelledby`, `aria-describedby` and `data-publish-outcome` so focus still lands on it. The preview panel shows the event as saved. No bar.

### 5.2 `EditorSummary` (new): the event summary card

**Desktop (lg and up), top of the rail:** `rounded-card border border-foreground bg-card p-4 flex flex-col gap-3`.
1. Thumbnail: `EventArt` 3:2, `rounded-control`, `aria-hidden` (decorative; the title carries the name).
2. Title: live from the `title` state, `text-base leading-6 font-semibold break-words line-clamp-3`. Blank: "Untitled event" in `text-muted`.
3. When: `text-sm leading-5 text-muted`, "Sat 8 Nov, 7:00 pm" from the live start in the event's zone (`startInstant(...)` and `lib/format`); blank: "Date to be added".
4. Status: `StatusBadge` with the dashboard's word and tone (`lib/organiser-events.ts`): Draft (neutral), Waiting for review (pending), Published (approved), Rejected (rejected), Unpublished (neutral; a draft Sheltüh took off). A new, unsaved event shows "Draft" and beneath it `meta text-muted` "Not saved yet".
5. `meta text-muted` "Last saved 2:14 pm" from `current.updatedAt` (the version already in state), in the viewer's local time. Absent for a new event.
6. Price: when the event is Sheltüh-ticketed and has at least one valid ticket, a line `text-sm tabular-nums` "From A$13.30" with `text-xs text-muted` "all-inclusive" beneath it, computed with `formatFeedPriceParts` on the mapped preview event (so it is exactly what the event page shows; a free-only event says "Free").

**Admin mode:** adds `text-sm text-muted` "Organiser: {name}" (and "(platform-managed)") under the status, replacing the `bg-surface p-4` organiser box that sits above the form today. Any status is editable.

**Below lg:** a compact row, no border: `flex items-start gap-3`: 48px thumbnail, then title (2-line clamp), the status badge, and the date line.

### 5.3 `StepNav` (new): rail (lg and up) and phone stepper (below lg)

**Rail** (`<nav aria-label="Event steps">` with `<ol class="flex flex-col gap-1">`, below the summary card, `mt-6`):

- Each item is a `<button type="button" aria-current="step" (current only)>` that fills the row: `flex w-full items-start gap-3 rounded-control px-2 py-2 text-left min-h-14`.
- Marker: `size-7 shrink-0 rounded-control border border-foreground flex items-center justify-center meta` with the numeral. **Current:** `bg-foreground text-background` and the label `font-semibold`. **Complete:** `bg-card` with a 16px check glyph (inline SVG, `viewBox="0 0 16 16"`, stroke 2, `currentColor`, `aria-hidden`). **Upcoming:** `bg-card` with the numeral. A step with errors after a failed save shows a count badge to the right of the label: the `CountBadge` look (read `components/ui/CountBadge.tsx`; reuse it if it takes text, else a `border border-danger text-danger rounded-badge` badge in `eyebrow` type), with text "{n}" and `aria-label` "{n} fields need fixing".
- Text: label (`text-sm leading-5 font-semibold`) and, under it, description (`text-xs leading-4 text-muted`): "Photo, details, venue and date" / "Prices, seating and refunds" / "Check it and go live" (admin: "Check it and publish").
- The accessible name is `{label}` plus an `sr-only` state: ", current step", ", complete", ", {n} fields need fixing". Keep the label text first so "Label in Name" holds.
- States: hover (`@media (hover: hover)`) `bg-surface`; focus-visible: the global 2px `foreground` outline, offset 3px (don't override); active: nothing extra; disabled: none (steps are never disabled; the Publish step is reachable at any time and says what is missing); loading/busy: not applicable (Save's busy state lives on the bar).

**Phone stepper** (below lg), above the notices:
- A row: `meta text-muted` "Step 1 of 3" (left, `aria-hidden`; the current item already says it) and the **Preview** button (right, `buttonClass("outline","sm","min-h-11")`, below xl only; see 5.10).
- Then `<nav aria-label="Event steps"><ol class="grid grid-cols-3 gap-2">`. Each `<button>` is `min-h-14 flex flex-col items-start gap-1 border-t-2 pt-2 text-left`, with `border-foreground` when current, `border-surface-border` otherwise (the state is also carried by the bold label, the numeral, `aria-current="step"` and the sr-only word; never by the rule alone). Label `text-sm font-semibold`: **Event page**, **Tickets**, **Publish** (about 78px at 14px/600, fits an 88px column at 320). The description shows from sm only (`hidden sm:block`). Numeral and glyph/badge on the first line in `meta`.

### 5.4 `EditorCard` (new): the section card

```
<section aria-labelledby={id}  class="rounded-card border border-foreground bg-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex flex-col gap-1">
    <h3 id={id} class="font-heading text-lg leading-6 text-foreground">Title</h3>
    <p class="text-sm leading-5 text-muted max-w-prose">Helper line</p>
  </header>
  <div class="flex flex-col gap-5">...fields...</div>
</section>
```

- Optional `action` slot on the right of the header (`sm:flex-row sm:items-start sm:justify-between`), used for **Add ticket type**.
- `titled={false}` variant (chrome only) for children that already render their own `fieldset` + `legend` (`SeatingChoiceField`, `RefundPolicyField`, the admin "Where are tickets sold?" fieldset): the card supplies the border and padding; the child's `legend` carries the title, styled with `SECTION_TITLE`. No second visible title.
- The Venue card keeps `id={VENUE_LOCATION_ID}`, `tabIndex={-1}`, `role="group"`, `aria-labelledby="venue-heading"`, `aria-describedby` (the location error) and `outline-offset-4`, with its h3 `id="venue-heading"` and text "Venue".
- No collapse and no "+" affordance: every card is always open (one less state, and nothing is hidden from keyboard or screen-reader users). Optional content says "(optional)" in its title, as the clip already does.
- States: cards have no hover or press state (they aren't controls). A card containing an error gains nothing beyond its inline error text and invalid controls (`aria-invalid` red border); no left rule is added to the card (that rule is reserved for notices).

### 5.5 Step 1 "Event page": cards in order

Step title: `h2.display-md` "Build your event page". Intro `text-sm leading-5 text-muted`: "Add a photo, the details, the venue and the date. You can save a draft at any point."

**Admin only, first:** card "Organiser" holding `AdminOrganiserPicker` (new event) or the organiser readout (existing event: name, "(platform-managed)", and the "This event is published: your changes go live as soon as you save." line), and the platform-managed note (`border-l-2 border-foreground`). Unchanged copy.

**Card 1: Photo and clip** (`h3` "Photo and clip"). Helper: with clips on, "Add a photo to lead your event page. A short clip is optional: it plays when someone taps the photo."; with clips off, "Add a photo to lead your event page."

- **Photo block** (`EventImageField`, restyled; ids and wiring unchanged: `event-image-title`, `event-image`, `event-image-pick`, `event-image-hint`, `event-image-error`, `aria-labelledby`, `aria-describedby`, `aria-invalid`).
  - Row: `flex flex-col gap-4 sm:flex-row sm:items-start`. Frame: `aspect-[3/2] w-full sm:w-64 shrink-0 overflow-hidden rounded-control bg-surface` (256px wide from sm; full card width below), content `EventArt fit="auto"` (photo, or poster fallback). Controls column: `flex flex-col items-start gap-3`: the label-button ("Choose a photo" / "Choose another photo", `buttonClass("outline","sm","min-h-11 cursor-pointer ...peer-focus-visible...")`, unchanged), the hint (existing text), and the Remove photo / Discard new photo `Button` (`variant="outline" size="sm"`, add `min-h-11`; it has no min-height today).
  - Caption under the frame (`text-xs leading-4 text-muted`): "Shown at 3:2 on the event page and 4:3 on phones." plus the no-photo line from section 4.
  - States: loading the saved photo ("Loading…" is shown as `text-xs text-muted` centred over the `bg-surface` frame, and the poster is not shown meanwhile), failed ("Couldn't load the preview", existing), pick error and server error (existing `text-sm text-danger`, `id="event-image-error"`).
- **Clip block** (`EventClipField`, shown only when `clipField` is true, same rule as today): below a `border-t border-surface-border pt-5 mt-1` divider. Same heading style as the photo block's label: `eyebrow text-muted` "Event clip (optional)" (`id="event-clip-title"`, unchanged). It is the same size as the photo: the preview box changes from `w-40 ... max-h-60` to the 3:2 frame (`aspect-[3/2] w-full sm:w-64 shrink-0 overflow-hidden rounded-control bg-ink`, `<video controls muted playsInline preload="metadata" className="size-full object-contain">`; empty state `bg-surface` "No clip yet"). Everything else is **exactly `event-clips.md` §5.4**: choose / choose another / Remove clip / Discard new clip / Undo, the hint, the description textarea (`id="event-clip-description"`, 300 characters, counter), the rights checkbox, the progress and status line (`aria-live="polite"`), Cancel upload, Try again, the error table, `#event-clip-error` with `tabIndex={-1}` and focus on failure. Full-width rows beneath the frame-and-actions row: description, rights, progress, error.
  - With uploads off (`NEXT_PUBLIC_EVENT_CLIPS` unset) the organiser sees no clip block, and an admin whose event already has a clip sees the reduced field, as today.
  - Why this is "prominent": it is in the first card of the page, has a frame the same size as the photo's (not an afterthought row of small controls), and carries a visible sub-title; on a 1280 screen both frames are visible without scrolling.

**Card 2: Event details** (`h3` "Event details"; helper "The name and description people see first.").
- `title` input (`fieldClass`, add `font-semibold`; label "Title"), then `category` select (label "Category", options from `EVENT_CATEGORIES`, `sm:max-w-xs`), then `description` textarea (`rows={6}`, was 4; label "Description"). The DOM order changes from title, description, category to title, category, description; the error order in `invalidControlIds` is unaffected (category has no error).
- Hint under description (new, `id="description-hint"`, `text-xs text-muted`): "Shown in About this event." When the field has an error, `aria-describedby` is both ids: `"description-hint description-error"`.
- Errors: `title-error`, `description-error` (existing, `text-sm text-danger`).

**Card 3: Venue** (h3 "Venue"; helper "Where guests go. Publishing needs a confirmed pin on the map.").
- Contents, in the current order, nothing removed: `VenuePlaceLink` (search / linked place / manual pin), then a `grid grid-cols-1 gap-5 sm:grid-cols-2`: Venue name (`venueName`), Venue address (`venueAddress`), Suburb (`VenueSuburbField`, `sm:col-span-1`), and the zone choice (`VenueZoneField`, `sm:col-span-2`, only when `zoneChoice`); then `VenuePinStep` (`venueLocation.mode !== "search"`), full width.
- The grid was `sm:grid-cols-3` in a 1088px column; in a 552px card three columns would be 170px each, so it is two.
- The pin map keeps its internal markup. Two requirements for the engineer: (a) wrap the map in `isolate` (a stacking context) so Leaflet's panes (z-index up to 700) can't paint over the sticky bar (`z-20`); (b) the Leaflet instance must call `invalidateSize()` whenever its panel becomes visible again (a `ResizeObserver` on the container), since step 1's panel is `hidden` while the user is on another step.
- Errors: `venueName-error`, `venueAddress-error`, the suburb and zone errors, `location-error` (`VENUE_LOCATION_ERROR_ID`), all existing.

**Card 4: Date and time** (h3 "Date and time"; helper "Times are in the venue's time zone, taken from its suburb.").
- Two `fieldset`s, one per row, unchanged semantics: legend `eyebrow text-muted` "Starts ({zoneName})" and "Ends ({zoneName})", each containing the date and time inputs with the existing `id`s (`start-date`, `start-time`, `end-date`, `end-time`), `aria-label`s ("Start date", "Start time", "End date", "End time") and `invalidProps("start" | "end")`.
- Inside each fieldset: `grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2` below sm (as today, so 320px still works with a 152px date field), `sm:grid-cols-2 sm:gap-3` from sm (270px each in a 552px card). The two fieldsets stack (`flex flex-col gap-5`); the old `lg:grid-cols-2` side-by-side is dropped (it would give 128px date fields in this column).
- The `data-zone-note` live region stays directly under the card's fields (`aria-live="polite"`, `empty:sr-only`, `-mt-3` becomes `-mt-1`), with the same "Times are now Perth time (were Melbourne time)." text.
- **Single event only.** There is no "Recurring event" choice (7.1).

### 5.6 Step 2 "Tickets": cards in order

Step title "Add tickets". Intro: "Set prices, seating and refunds. Buyers see the all-inclusive price, with the booking fee included." (When a ticket is "Organiser absorbs" the sentence is still true: the price shown is the total.)

- **Admin: "Where are tickets sold?"** `titled={false}` card around the existing `fieldset` (legend `SECTION_TITLE`), radios `ticketingMode` ("On Sheltüh" / "On another site"), the `externalTicketUrl` field and "Entry is free" checkbox, with `externalTicketUrl-error`. Unchanged markup. Wrap each radio label `flex min-h-11 items-center gap-2` so the targets are 44px.
- **Organiser, external event:** one card with the existing "Tickets are sold on {provider}" block (its `bg-surface p-4` styling becomes the card's own content: the `font-medium` line, then the `break-all text-muted` URL). When `ticketingMode === "external"`, the seating, ticket types and refund cards are not rendered (as today), and step 2's completion is true.
- **Seating** (`SeatingChoiceField`, `titled={false}` card; only when `ticketingMode === "sheltuh"`; `legendClassName={SECTION_TITLE}`). Unchanged.
- **Ticket types** (h3 "Ticket types", action slot: `Add ticket type`, `id="add-ticket-type"`, `.btn .btn-outline min-h-11`, `aria-describedby` the `ticketTypes` error):
  - `PayoutsNeededNotice` first when `payoutsNeeded`, then the `ticketTypes-error` paragraph.
  - Each ticket is a block (not a nested box): `flex flex-col gap-3`; blocks after the first get `border-t border-surface-border pt-5`. Header row: `eyebrow text-muted` "Ticket {n}" (left) and "Remove this ticket type" (right, only when more than one; `text-sm text-danger underline underline-offset-2`, now `inline-flex min-h-11 items-center`).
  - Fields `grid grid-cols-1 gap-3 sm:grid-cols-2`, in the existing order and with the existing ids: Name, Price (A$), Who pays the booking fee?, Quantity available. `FeePolicyHelp` stays under the select (`ticket-{i}-fee-help`) and spans both columns from sm (`sm:col-span-2` on a wrapper) so its four lines get width.
  - **All-inclusive line** (existing sentence, restyled): `text-sm leading-5 text-foreground` with the total in `font-semibold tabular-nums`: "Buyer pays **A$13.30** total (A$12.00 ticket + A$1.30 booking fee)." / "Free — no booking fee." / "...fee absorbed by you." The amounts are the existing `calculateOrderSummary` results. No new calculation anywhere.
  - Errors per field as today (`ticket-{i}-name-error` etc.).
  - Not designed: ticket sale dates, hidden tickets, promo codes, per-ticket description (7.1, 7.4).
- **Refund policy** (`RefundPolicyField`, `titled={false}` card; `legendClassName={SECTION_TITLE}`; only for Sheltüh-ticketed events). Unchanged internals and focus refs (`refundChoiceRef`, `refundDaysRef`).

### 5.7 Step 3 "Publish": cards in order

Step title "Publish". Intro by situation (existing facts only):
- Organiser, draft: "Check the list, then publish. Your changes are saved first."
- Organiser, `reviewReason` known: the intro adds, as its own line, the existing `PUBLISH_REVIEW_REASON_TEXT[reviewReason]` (so the owner knows before clicking that it will go to review).
- Organiser, rejected or unpublished (`removed`): "It goes to Sheltüh for review again before it goes live."
- Admin: "Save your changes. Tick Publish when saved to put it live."

**Card 1: Before you publish** (h3). A `ul` of rows, one per check; each row `flex items-start gap-3 min-h-11`: a 16px glyph, the check name (`text-sm font-semibold`), a state word (`text-sm text-muted`), and for anything not done a `text-sm underline underline-offset-4` button "Go to {Title / Venue / Date and time / Tickets}" that switches step and focuses the control (the same function the error summary uses; accessible name e.g. "Go to Venue: add the venue location and confirm the pin"). Glyphs: check (done), alert triangle (needs attention, stroke 2, `text-danger` with the word always present), dash (optional or n/a). Never an emoji and never a colour-only dot.

| Row | Done when | Needs attention |
| --- | --- | --- |
| Title | `title.trim()` | "Add a title" |
| Description | `description.trim()` | "Add a description" |
| Venue | venue name, address and a known suburb | "Add the venue" |
| Venue pin | `venueLocation.hasPin` | "Add the venue location and confirm the pin first." (the existing `LOCATION_REQUIRED_TEXT`) |
| Date and time | start and end set | "Add the start and end" |
| Tickets | external, or valid ticket types | "Fix the ticket types" |
| Refund policy | valid, or n/a | "Enter the refund days" |
| Photo | Optional: "No photo: generated artwork is used" | never blocking |
| Clip | shown only when clips are on: Optional | never blocking |
| Payouts (organiser, paid Sheltüh tickets) | `payoutsEnabled` | "Set up payouts before publishing" with the existing link from `PayoutsPublishHint` |

These rows are advisory and derived (5.0). The server and `buildInput` remain the authority; if a check passes here and the server refuses, the existing refusal blocks show.

**Card 2: Publish** (organiser, existing event only; for a new unsaved event this card says "Save the draft first. Publishing opens once it is saved." and has no button, which is today's behaviour: the button needs `initial`).
- Contents, with their existing ids, refs and focus rules: `PayoutsPublishError` / `PayoutsPublishHint`, the `publish-refusal` group (`tabIndex={-1}`, `role="group"`, Reload page button), the **Publish…** button (`publishOpenRef`; label "Send for review" when `removed`, "Sending…" while `submitting`; `busy` not `disabled`; `aria-describedby={submitDescription}`), and `PublishConfirm` (`role="group"`, Escape closes, Cancel focused first, Publish now / Send for review). The confirm block keeps `border-l-2 border-foreground`.
- The Publish… button is `variant="solid"` here (the one primary on this step) and is the **only** instance of it: the bar on step 3 doesn't repeat it (so `publishOpenRef` and the focus return after Cancel have one target).

**Admin step 3 card: "Save and publish":** the existing `admin-reason` textarea ("Note for the event's log (optional; the organiser sees it)", with its hint and error) and the "Publish when saved" / "Publish straight away" checkbox (`min-h-11` label), only when the event isn't published. The conflict block stays in the notices slot.

### 5.8 `EditorBar` (new): the sticky save bar

- `data-edit-bar`, `sticky bottom-0 z-20 -mx-5 border-t border-foreground bg-background sm:-mx-8` with an inner `mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-2 sm:px-8 min-h-16 pb-[calc(0.5rem+env(safe-area-inset-bottom))]`. It is the last child of the shell, so it settles under the content at the page's end instead of covering it (the event page buy bar's pattern). No shadow: the top border is the elevation, and it shows in Dark because `foreground` is white there.
- Left (from sm): `meta text-muted` "Last saved 2:14 pm" (not live: the `role="status"` line stays in the notices slot, so there is no double announcement). Hidden below sm.
- Right, `flex items-center gap-2`, buttons `.btn btn-sm min-h-11 px-3` below sm and `.btn` (md, `min-h-11`) from sm:

| Step | Organiser | Admin |
| --- | --- | --- |
| 1 and 2 | **Save draft** (solid, `ref={saveRef}`, `busy={saving}`, "Saving…") and **Next** (outline; accessible name "Next: Tickets" / "Next: Publish", visible text "Next") | **Save changes** / **Create event** (solid, the existing `saveLabel`) and Next (outline) |
| 3 | Save draft (solid) and **Back** (outline; name "Back: Tickets"). Publish… is in the card, not here. | Save changes (solid) and Back (outline) |

- `saveLabel(...)` stays the single source of the Save text, including "Save draft and set up seats", "Create event and set up seats", "Save and set up seats". Long labels may wrap to two lines on a phone (`whitespace-normal text-center`; the bar grows, `min-h-16` is a minimum). At 320 the two-button row for the short labels is about 190px of 280px.
- **Next and Back are navigation only.** They save nothing and say nothing about saving; the bar's meta line shows when it was last saved. If the user clicks Next with unsaved edits, the edits remain in the form and are saved by Save or by Publish (which saves what's on screen first, as today).
- Save is `busy` (`aria-disabled`, "Saving…"), never `disabled`, so it keeps focus (as today). Next and Back stay enabled while saving.
- The Preview button is not in the bar (the bar already has two buttons at 320). It sits in the header row (5.3 on phones; on tablets and small desktops it is the same button, right-aligned above the cards: `flex justify-end`).

### 5.9 `ErrorSummary` (new)

Shown at the top of the notices slot while `Object.keys(errors).length > 0` (after a failed save, a failed publish or a server `fieldErrors` response); gone as errors are cleared by editing (`clearErrors`).

- Markup: `<section aria-labelledby="error-summary-title" class="border-l-2 border-danger py-1 pl-4 text-sm text-foreground">`. **No `role="alert"` and no focus move**: today's behaviour already moves focus to the first invalid control and announces "Not saved: N fields need fixing. The first one is focused." in the `role="status"` line; a second announcement would be noise.
- Title (`id="error-summary-title"`, `font-semibold`): "{n} field needs fixing" / "{n} fields need fixing".
- Body: for each step with errors, a `font-medium` step name line ("Event page", "Tickets") then a `ul`; each item is a button styled as a link (`inline-flex min-h-11 items-center text-left underline underline-offset-4 sm:min-h-6`), text "{Field}: {message}" (e.g. "Title: Enter an event title."). Items follow `invalidControlIds` order. Activating one switches step, focuses that control (`document.getElementById`) and scrolls it clear of the bar (the `scroll-padding-*` rules do this).
- Field names for the list: `title` Title; `description` Description; `venueName` Venue name; `venueAddress` Venue address; `suburb`/`state`/`timeZone` Suburb; `location` Venue location; `start` Start; `end` End; `externalTicketUrl` Ticket page address; `ticketTypes` Ticket types; `ticket-{i}-name` Ticket {i+1} name; `...price` Ticket {i+1} price; `...qty` Ticket {i+1} quantity; `refundPolicy`/`refundDays` Refund policy; `organiserId` Organiser; `image` Photo; `reason` Note.
- Per-step badges in the stepper and rail come from the same grouping.

### 5.10 Preview (`PreviewPanel`, `PreviewSheet`, `PreviewFrame`, `draftToPreviewEvent`: new)

**What it renders.** The real `EventDetailsView` for the draft, so every future change to the event page shows up in the preview for free. A pure `draftToPreviewEvent(...)` maps the editor's state to the `SheltuhEvent` the page takes, in the same field order as `lib/live/adapt.ts` `adaptPublicEvent` (so the two can be read side by side): title, description, category, suburb, venue name and address, `coordinates` from the confirmed pin, `venuePlaceId`, `state`, `timeZone`, `startsAt` / `endsAt` from `localToUtcIso(start|end, timeZone)` (undefined while half-typed), organiser name and `organiserLogoThumbUrl` (the organiser's own, from `useOrganiser`; admin: the picked organiser), `poster: assignPoster(slug ?? eventId ?? "new")`, `imageUrl` (the object URL), `clip` (the local object URL, duration, dimensions, description) when one is chosen or saved, `ticketTypes` (all with `soldOut` absent), `ticketingMode`, external fields, `refundPolicy` and `refundDays`. No `seating` (7.4).

**Placeholders.** Anything missing renders the page's own markup with muted stand-in text instead of crashing on `undefined`: title "Untitled event"; description "Add a description"; when "Date and time to be added"; where "Venue to be added"; tickets "Tickets coming soon." (the page's existing empty line). The mapper returns `{ event, missing }`; `EventDetailsView` gets an optional `preview` prop (`{ missing }`) that swaps those four values, and nothing else about its markup. Placeholder text is `text-muted`.

**A preview mode for `EventDetailsView`** (the one change to the event page, with no effect on the live page when the prop is absent): when `preview` is set it must not render or call `EventViewBeacon`, `SaveOnReturn`, `TicketsHashFocus`, `WhosGoingProvider` / `WhosGoing` / `WhosGoingSummaryLink`, the `BackLink`, or the "Report this event" line; the buy bar is `static` (not `sticky`); `ExternalTicketLink` must not record a click; nothing in the preview is focusable or clickable. The simplest guarantee is `inert` on the preview's wrapper (the browser removes it from tab order and ignores clicks). The engineer must check that `TicketSelector` renders its normal tier rows (all-inclusive prices) with no "Demo" disclosure and no network call in preview, else add the same `preview` check there.

**How a phone viewport is faked honestly.** The event page's layout is driven by viewport media queries (`sm:`, `lg:`), so rendering it into a 320px `div` on a 1280px screen would show the two-column desktop layout. The preview therefore renders into a **same-document `srcdoc` iframe through a React portal** (the technique `react-frame-component` uses): `<iframe title="Event page preview" srcDoc="<!doctype html><html lang='en'><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>" tabIndex={-1} class="block h-full w-full border-0">`. On load, copy the parent's `<link rel="stylesheet">` and `<style>` elements into the iframe head, copy `<html>`'s `class` (the three font variable classes) and `data-theme`, copy `<body>`'s `class`, then `createPortal(<EventDetailsView preview .../>, iframe.contentDocument.body)`. A `MutationObserver` on the parent `<html data-theme>` keeps Light / Dark in sync. Media queries then evaluate against the iframe's own width, so 320px really is the phone layout, and the whole page is the real component.
- Why not a `/event-preview` route in an iframe: the site forbids framing everywhere (`X-Frame-Options: DENY` and `frame-ancestors 'none'` in `next.config.ts`, pinned by `tests/next-config.test.ts` and `e2e/checkout-csp.spec.ts`). A route would need an exception for one path, a `postMessage` protocol, a chrome-less layout (Nav, Footer and DemoBanner are in `app/layout.tsx`) and a security review. `srcdoc` needs none of those: no new route, no header change, and blob URLs from the parent just work (same origin). **If the portal approach proves fragile in implementation, the fallback is that route plus a one-path framing exception, which is a security-reviewer decision (7.3), not a frontend one.**

**Desktop panel (xl and up, 1280+).**
- `<aside aria-label="Event page preview" id="event-preview">` in the third column, `xl:sticky xl:top-24 xl:w-88 xl:shrink-0`.
- Header: `flex items-center justify-between gap-3 pb-3`: `eyebrow text-muted` "Preview" and an outline sm `min-h-11` button "Hide preview" (`aria-expanded="true"`, `aria-controls="event-preview-frame"`). `meta text-muted` under it: "Phone, 320px wide. Not clickable."
- Frame: `id="event-preview-frame"`, `rounded-card border border-foreground overflow-hidden bg-surface`, the full 352px column. The iframe is `w-80` (320px) centred inside it, so the surface shows 16px either side and it reads as a device; the iframe's own page is `bg-background`. Height: `h-[calc(100dvh-11rem)] min-h-[28rem] max-h-[48rem]` (viewport minus the 6rem sticky top, the 4rem bar and 1rem gap). The iframe scrolls internally.
- **Hidden state:** the panel isn't rendered; the main column expands (still `max-w-3xl`); the header button reads "Show preview" (`aria-expanded="false"`, same `aria-controls`). Focus: after Hide, focus moves to that header button; after Show, to the panel's Hide button. The choice is per visit (not stored; 7.5).
- **Updates:** the mapped event is recomputed from state and the portal re-renders on a 250ms trailing debounce, so typing doesn't thrash it. No animation on update.
- **States:** loading (iframe not ready, or the stylesheet copy still pending): `DotsLoader` with the label "Loading preview" centred (existing component). Error (not ready within 5s, or a thrown render): `text-sm` "Couldn't load the preview." and an outline sm "Try again" that remounts the iframe. Empty (new event): the placeholders above. The preview shows the **draft as typed**, which may differ from what's saved; the "Last saved" line in the rail says when the saved version was made.

**Phone and tablet: the Preview button and sheet (below xl).**
- Button: in the header row (5.3), `buttonClass("outline","sm","min-h-11")`, text "Preview", `aria-haspopup="dialog"`. Hidden from xl.
- It opens the existing `SeatDialog` (bottom sheet below 640px, centred `sm:max-w-lg` from 640px; focus trapped and returned to the button on close, Escape closes) titled "Preview", containing the same `PreviewFrame`: iframe `w-full max-w-sm` (384px max, so 320 and 375 phones get their real width and a tablet gets a 384px phone), height `h-[calc(90dvh-8rem)]` (the sheet's 90dvh cap minus its title row, padding and gaps), `mx-auto`, same frame border and same states. The dialog's close control is SeatDialog's.
- The sheet's iframe is unmounted when it closes; opening it again shows current state.

### 5.11 Status behaviour (organiser and admin)

| Status | Summary badge (word, tone) | Editable | Notices (top slot) | Step 3 | Bar | Preview |
| --- | --- | --- | --- | --- | --- | --- |
| New (unsaved) | Draft (neutral), "Not saved yet" | Yes | none | Checklist, "Save the draft first" | Save draft, Next / Back | Draft placeholders |
| Draft | Draft (neutral) | Yes | none | Checklist, **Publish…** | as above | Draft as typed |
| Draft after Sheltüh took it down (`rejectionReason` on a draft) | Unpublished (neutral) | Yes | "Taken off Sheltüh — note from Sheltüh:" block + "When you send it for review again, a person at Sheltüh checks it before it goes live." | Checklist, **Send for review** (no question first, as today) | as above | Draft as typed |
| Waiting for review (`pending_review`) | Waiting for review (pending) | **No (locked view, 5.1)** | n/a | n/a | none | Event as saved |
| Published | Published (approved) | **No (locked view)** | n/a | n/a | none | Event as saved |
| Rejected | Rejected (rejected) | Yes | "Not approved — reviewer note:" block (`border-l-2 border-danger`) + the review-again sentence | Checklist, **Send for review** | as above | Draft as typed |
| After a publish | Published or Waiting for review | No | n/a | `PublishOutcomeView` in place of the form (5.1) | none | Event as saved |
| Admin, any status | the record's status | Always | conflict / session blocks as today | Note, Publish when saved | Save changes, Next / Back | Draft as typed |

All of this is the existing `locked`, `removed`, `reviewReason`, `outcome` logic; nothing about when a state applies changes.

### 5.12 Other states

- **Loading the event** (edit page): the existing `LoadingState` ("Loading event…"), no shell until the record arrives (as today).
- **Load error:** the existing `role="alert"` `text-danger` paragraph.
- **Not an approved organiser / accounts not configured (demo mode):** the existing cards and messages, unchanged. The editor is never rendered without Supabase configured, so the preview and the bar have no demo variant. Nothing in the editor relies on demo data.
- **Session expired mid-edit:** the existing block with `InlineReauth` in the notices slot; the form, step and typed values stay as typed (the page's `useKeptWhileSignedOut` already keeps it mounted).
- **Empty:** a new editor opens on step 1 with every field empty and the placeholders in the preview.
- **Save in progress:** Save is `busy` ("Saving…"). The clip field shows its own progress.
- **Disabled:** `.btn[aria-disabled]` (existing). No control in the editor uses the `disabled` attribute on something that may hold focus.

## 6. Motion

Nothing new loops or autoplays, and nothing needs a `prefers-reduced-motion` branch of its own.

- Step switch: instant (`hidden` toggles). The scroll to the step title uses the page's existing `scroll-behavior: smooth`, which `globals.css` already sets only under `prefers-reduced-motion: no-preference`.
- Hover colour changes: the existing 150ms transitions on `.btn`. Press: the existing `.btn:active` 1px translate, already motion-gated.
- Preview update: no transition (content swaps). Preview loading uses `DotsLoader`, whose dots hold still under reduced motion (existing).
- The clip field's progress bar and the preview clip are as in `event-clips.md` §6: the preview video never autoplays (`controls`, `muted`, no `autoPlay`), and it is `inert` anyway.
- The sticky bar and rail have no entrance animation. The error summary appears without animation.

## 7. Dependencies and out of scope

### 7.1 Needs backend, owner decision (NOT designed in)

Each is a feature the reference tool has that Sheltüh's API and data model don't support today (`EventInput`, `EventRecord`). The editor shows none of them, and shows no disabled or "coming soon" controls for them.

1. **Recurring events** (the single / recurring choice, repeat rules, occurrences, per-occurrence tickets, check-in and refunds per date).
2. **Online events** (venue type, a join link, hiding the link until ticketed, the event page's location block and maps, and what `location_required` should mean).
3. **To be announced venue** (publishing without a pin today is refused with `location_required`; a TBA state needs a rule, an event-page treatment and a way to fill it in later).
4. **FAQs** ("Good to know" questions and answers).
5. **Structured "Good to know"** (audience, what to expect, age restriction, accessibility). `SheltuhEvent` has these four fields and `EventDetailsView` renders them, but only demo sample events carry them: `EventInput` and the live record have no such fields, so the editor can't set them.
6. **Lineup / performers** and other add-on sections (schedule, partners, links, extra photos or a gallery).
7. **Sub-category and tags** (category is a single enum: live-music, art, workshop, pop-up, theatre).
8. **Time zone override and display options** (zone is derived from the suburb and state; "hide end time", "show the zone" etc.).
9. **Stored crop or focal point** for the photo (today there is no crop data; `EventArt` centres).
10. **Scheduled publish** ("go live on...").
11. **Ticket sale windows, hidden tickets, promo codes, capacity across tickets.**
12. **A shareable preview link** for a draft or a pending event (the in-editor preview is local only).
13. **Autosave of drafts** (a new save cadence and conflict story for organisers; admins already have `expectedUpdatedAt`).

### 7.2 Frontend work (no backend, no new API)

1. New components in `components/dashboard/editor/`: `EditorShell`, `EditorSummary`, `StepNav`, `EditorCard`, `EditorBar`, `ErrorSummary`, `PreviewPanel`, `PreviewSheet`, `PreviewFrame`, plus `draftToPreviewEvent` and `draftProblems` in `lib/` or alongside.
2. `EventEditor.tsx`: regroup the JSX per section 5 (state, handlers, ids, refs and messages unchanged); add `step` state; make every `focusInvalidId.current = ...` also set the owning step (5.0); extract `draftProblems(...)` from `buildInput`'s checks so `buildInput`, the checklist and the step markers share one definition (this is the only logic touched, and it needs a test that `buildInput` returns the same errors as before for every case in `tests/`).
3. `EventImageField.tsx`: 3:2 frame with `EventArt`, `min-h-11` on the discard button, and **expose the preview URL** (an `onPreviewUrl` callback, or lift the two object-URL effects into a hook the editor owns) so the frame, summary and preview share it.
4. `EventClipField.tsx`: restyle the preview box (3:2) only; expose the preview URL, duration, dimensions and description to the preview mapper (read them from `useEventClip` state; add nothing to its API calls).
5. `EventDetailsView.tsx`: the `preview` prop (5.10). Verify it has no server-only imports (it reads `siteOrigin()` for the report link, which is skipped in preview) so it can render inside a client tree, and that `TicketSelector` shows normal tiers with no Demo text in preview.
6. `VenuePinMap*`: `isolate` wrapper and `invalidateSize` on re-show (5.5).
7. `app/globals.css`: `--editbar-h` and the `[data-edit-bar]` scroll rule (2.2).
8. `app/dashboard/new/page.tsx` and the edit page: widen the wrapper to `max-w-7xl` (3).
9. Copy introduced here (kept to the minimum; all other strings are existing): step titles and intros, "Photo and clip" and its helper, "Event details", the "Venue" and "Date and time" helpers, the "Before you publish" rows, "Last saved", "Preview" / "Hide preview" / "Show preview", the preview caption, "Next: ...", "Back: ...", "Shown in About this event.", "Your event shows generated artwork until you add one."

### 7.3 Security and reviews

No new endpoint, no header change, no new storage. The preview renders only the user's own draft data and blob URLs already in their browser, and the `srcdoc` iframe inherits the page's origin and CSP, so the framing policy (`DENY`) is untouched. If the fallback route is ever chosen (5.10), `security-reviewer` must sign off on a one-path `frame-ancestors 'self'` exception. Hand-offs: `frontend-engineer` to build; `ux-accessibility-reviewer` (step switching and focus-on-error, the error summary, the sheet); `test-engineer`; `visual-qa` at 320, 375, 768 and 1280, Light and Dark.

### 7.4 Test impact and open questions

- **Tests** that find editor fields by label or role may need the right step active first (hidden panels are not in the accessibility tree). Cases to add: each step's `hidden` toggle keeps typed values; a failed save on a step-2 error while on step 1 switches to step 2 and focuses the field; `buildInput` unchanged for all existing error cases; Publish… exists once (step 3) and focus returns to it after Cancel; the locked and outcome views; a 320px render has no horizontal overflow (`e2e/responsive.spec.ts`).
- **Hint wording.** The photo hint says "A square or portrait poster or photo works best", but the event page crops to 3:2 and 4:3 and `fit="auto"` letterboxes portrait photos. This spec leaves the string unchanged (no copy change was asked for); the owner may want "A landscape photo works best" once they see the 3:2 frame.
- **Ticket description.** `TicketTypeInput.description` exists in the API and `adaptPublicEvent` carries it, but the editor has never exposed it. It would be a frontend-only addition if the server already validates it; not designed in here, owner decision.
- **Seated events in the preview.** The preview has no seat map, so a reserved-seating draft previews as general admission. Acceptable for v1; say so in the preview header if the owner prefers.

### 7.5 Proposals (manager decision, not part of this spec)

- Persist the preview's open or hidden state (`localStorage`, like the theme) so it doesn't reset each visit.
- Put the step in the URL hash (`#tickets`) so a reload or the browser's Back returns to it.
- A leave-the-page warning (`beforeunload`) when the form has unsaved changes. It needs dirty-tracking the editor doesn't have; a change in behaviour.
- A desktop-width preview toggle once a wider panel is possible.

### 7.6 Out of scope

The dashboard list, the seat-map editor, check-in, analytics, payouts, the organiser profile form, the event page's own design, and any change to `lib/fees.ts`, `lib/api/*`, validation text, or the `EventInput` payload.

## 8. Review checklist (for `visual-qa`)

1. At 320px there is no horizontal scroll on any step; the date inputs still show a usable date field; the stepper's three labels fit on one line; the bar's two buttons fit (Save draft plus Next).
2. At 375px the stepper, compact summary and Preview button don't wrap awkwardly; the media frames are 3:2.
3. At 768px the media row is frame (256px) beside controls; the stepper shows descriptions; the Preview button opens a centred sheet with a 384px phone.
4. At 1280px all three columns show with no overlap: rail 208, main 592, preview 352; hiding the preview widens the main column to 768 max and the button label flips.
5. No shadows, no pills (`rounded-full` only on radios and checkboxes), no orange anywhere in the editor, no text on any image.
6. Dark: card borders are white, the bar's top rule is visible, the preview iframe follows the theme.
7. A failed save with errors on two steps shows the summary grouped by step, focuses the first field on the right step, and the count badges match.
8. The clip block is in the first card, with a frame the same size as the photo's; with `NEXT_PUBLIC_EVENT_CLIPS` unset, organisers see no clip block.
9. Prices in the ticket rows and the preview are the all-inclusive totals; free tickets say "Free — no booking fee."
10. A focused field is never hidden under the sticky bar when tabbing through any step.
