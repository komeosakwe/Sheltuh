# Who's Going: design spec

Status: proposed · Owner: ui-design-director · Scope: the "Who's Going" panel on the event
page (`components/EventDetailsView.tsx` aside, above Tickets) and a new `/account` page
(edit display name, delete social profile). Desktop and phone. No other surface changes.

Code read: `docs/design-system.md`, `docs/design/mobile.md`, `app/globals.css`,
`components/EventDetailsView.tsx`, `TicketSelector.tsx`, `LiveEventDetails.tsx`,
`DemoNotice.tsx`, `AuthNavLinks.tsx`, `ui/Section.tsx` (`Panel`, `Notice`, `EmptyState`),
`ui/Button.tsx`, `ui/Field.tsx`, `lib/auth/AuthContext.tsx`, `components/auth/LoginForm.tsx`,
`app/privacy/page.tsx`, `supabase/migrations/20260925000000_init.sql` (orders/tickets).

---

## 1. Principles

1. **A guest list, not a social feed.** Names set like a gallery-opening list: plain Inter
   text, square initials, hairline rules. No faces, likes, follower counts or badges.
2. **The number is the moment.** One Anton numeral ("14") carries the social proof; everything
   else is 14px Inter. Scale contrast, as elsewhere on the page.
3. **Consent is visible at the point of choice.** Whoever adds themselves reads, in one short
   paragraph, exactly who sees what, and can undo it in one tap from the same place.
4. **Never crowd the purchase.** The panel sits above Tickets but stays short (collapsed
   budget ≤ 300px on desktop), never blocks Checkout, and never uses a solid pill while
   Checkout's solid pill could share the viewport, except the one form submit (§5.4).
5. **Honest at small numbers.** Under 3 people opted in, no number is shown anywhere.

## 2. Tokens

No new colours, radii, fonts or spacing steps. One motion utility is added (§6).

| Text / background | Ratio | Use |
| --- | --- | --- |
| `foreground` / `background` | 17.3:1 | Names, count, body |
| `muted` / `background` | 4.9:1 | Secondary lines, hints (≥12px) |
| `foreground` / `surface` | 15.8:1 | Initials in other people's avatars |
| `background` / `foreground` | 17.3:1 | Initials in the viewer's own avatar |
| `danger` / `background` | 5.7:1 | Field errors, delete pill |

| Role | Family | Size / line-height | Tracking | Case | Weight |
| --- | --- | --- | --- | --- | --- |
| Panel title (`Panel title`) | Anton | 24px / 0.95 (existing `display-md !text-2xl`) | 0 | upper | 400 |
| Count numeral | Anton | 40px / 40px (`font-heading text-[2.5rem] leading-none tabular-nums`) | 0 | — | 400 |
| Count label ("going" / "went") | Inter | 11px / 16px (`eyebrow text-muted`) | 0.14em | upper | 600 |
| Name | Inter | 14px / 20px (`text-sm leading-5`) | 0 | as entered | 400; viewer "You" 600 |
| Secondary line ("Shown as Mia T.") | Inter | 12px / 16px (`text-xs text-muted`) | 0 | sentence | 400 |
| Initials | Inter | 11px / 16px | 0.04em | upper | 600 |
| Consent / prompts | Inter | 14px / 20px (`text-sm leading-5`) | 0 | sentence | 400 |
| Field label | `Field` (eyebrow, muted) | 11px / 16px | 0.14em | upper | 600 |
| Inputs | `fieldClass` (16px phones, 14px `sm+`) | — | 0 | — | 400 |

Spacing uses the existing scale only (4, 8, 12, 16, 20, 24, 32, 48). Radii: 0 on
everything except pills and the native checkbox. Borders: `border-foreground` for the
Panel rule, `border-surface-border` between the list and the action row.

## 3. Grid and layout

**Placement.** Inside the existing `<aside>` of `EventDetailsView`, between the When/Where
`dl` and `<div id="tickets">`. The aside's `gap-6 sm:gap-8` provides spacing. Wrap it as
`<div id="whos-going" tabIndex={-1} className="focus:outline-none">` around
`<Panel title="Who's going">` (mirrors the Tickets anchor).

**Desktop (≥1024).** The aside is ~420px wide (`lg:col-span-5` of `max-w-6xl`). The names
grid is 2 columns (`grid grid-cols-2 gap-x-4 gap-y-3`), ~202px each.
Sticky overflow guard: when the list is expanded past its first page, or the opt-in form
is open, the panel root carries `data-wg-expanded`, and the aside adds
`lg:has-[[data-wg-expanded]]:static` so a tall aside never hides Tickets beneath the fold
while stuck. Collapsed, it keeps today's `lg:sticky lg:top-24`.

**Phone and tablet (<1024).** Order stays as `mobile.md` (e): … Good to know, **buy bar**,
When/Where, **Who's going**, Tickets. The buy bar settles directly above the aside, so it
can never cover this panel, its form or its buttons; `scroll-padding-bottom` already
covers focus while the bar is pinned. Names grid stays 2 columns down to 320 (280px
content → 132px columns, ~92px for the name after the avatar). Names `truncate`
visually; the full text stays in the DOM for screen readers.

**Phone social line (new, `lg:hidden`).** Because the panel sits below the buy bar's
settled point, add a third line to the key-facts paragraph under the title, only when a
count is shown (≥3) or in demo:
`<a href="#whos-going" className="mt-1 inline-flex min-h-11 items-center text-sm leading-5 underline underline-offset-4">14 going</a>`
(after the event: "14 went"). Hidden when the count is hidden, in loading and in error.

## 4. Imagery

No photos of people in this feature. Avatars are **initials squares** (not circles: they
are not controls, and the system reserves round shapes for pills and round controls).

- Size 32×32 (`size-8 shrink-0`), `flex items-center justify-center`, `aria-hidden`.
- Others: `bg-surface text-foreground`. Viewer ("You"): `bg-foreground text-background`.
- No per-person colours; the palette stays black and paper.
- Initials: first grapheme of the first and last word of the display name, uppercased
  (`Intl.Segmenter`; one word → one letter). A shared helper `lib/initials.ts` with unit
  tests (Latin, one word, accented, non-Latin, emoji-leading name → fall back to "·").
- Event art is unaffected; `EventArt` fallback rules are unchanged.

## 5. Components

### 5.1 `components/WhosGoingPanel.tsx` (new, client)

Props: `{ event: SheltuhEvent; demo: boolean }`. Rendered by `EventDetailsView` for both
demo and live. All API calls go through a new `lib/api/whos-going.ts` (backend dependency).

**Anatomy (top to bottom):**

1. `Panel` title "Who's going" (h2), or "Who went" once closed.
2. **Count row** `flex items-baseline gap-2 mb-4`: numeral + count label ("going" / "went").
   Omitted entirely when the count is hidden (<3 opted in).
3. **Names list** `ul` (`aria-label="People going"`), 2-col grid (§3). Each `li`:
   `flex min-w-0 items-center gap-2` → avatar + name `truncate text-sm leading-5`.
   Viewer's row is always first: avatar inverted, name **"You"** (600) and beneath it
   `text-xs text-muted` "Shown as {displayName}". It spans both columns (`col-span-2`).
4. **Show more** (when `nextCursor`): `Button variant="outline"` with
   `className="mt-4 min-h-11 w-full sm:w-auto"`, label "Show more".
5. **Action row** `mt-5 border-t border-surface-border pt-4 flex flex-col gap-3`, content per
   state below.
6. Visually hidden live region: `<p role="status" className="sr-only">` (one per panel,
   always mounted, text replaced per announcement).

**Page sizes.** First request `limit=6` (3 rows), each "Show more" `limit=12`. Keeps the
collapsed desktop panel ≤ 300px.

**States.** The viewer state comes from the API (`viewer.state`), never inferred client-side.

| State | Count row | Names | Action row |
| --- | --- | --- | --- |
| **Loading** (auth or data) | — | — | Panel shows `text-sm text-muted` "Loading who's going…", panel `aria-busy="true"`, `min-h-[7.5rem]` reserved to avoid shift. No spinner, no skeleton shimmer. |
| **Error** | — | — | `Notice tone="danger"` (no role; the live region announces "Couldn't load who's going."). Text: "Couldn't load who's going." + `Button variant="outline" size="sm" className="min-h-11"` "Try again". Tickets unaffected. |
| **Demo** | Shown (sample count ≥3) | Sample names, Show more works locally | Disabled "Add yourself" (`btn btn-lg w-full sm:w-auto cursor-not-allowed border-surface-border bg-surface-border text-muted`, `disabled aria-disabled="true"`) then `<DemoNotice>These names are samples. Adding yourself isn't available in this demo.</DemoNotice>` |
| **Signed out** | Shown if ≥3 | **Not rendered** (no names or initials sent to signed-out callers) | `text-sm` "Sign in to see who's going." as `ButtonLink variant="outline" className="min-h-11 w-full sm:w-auto" href="/login?next=/events/{slug}"` labelled "Sign in to see who's going". If count hidden, a line above it: "Be one of the first to add yourself." |
| **Signed in, no ticket** | Shown if ≥3 | Shown | `text-sm` "Get a ticket to add yourself." where "Get a ticket" is `<a href="#tickets" className="underline underline-offset-4 inline-flex min-h-11 items-center">`. |
| **Eligible, no profile yet** (has ticket) | Shown if ≥3 | Shown | "You've got a ticket. Want people to know you're going?" + `Button variant="outline" size="lg"` **"Add yourself"** (`aria-expanded`, `aria-controls="wg-form"`) → opens form §5.2. |
| **Eligible, has profile** | Shown if ≥3 | Shown | `text-sm` "Show up as {displayName}. [Edit name](/account)" + `Button variant="outline" size="lg"` **"Show me as going"** (one tap; consent paragraph from §5.2 repeated beneath in `text-xs text-muted`). Busy label "Adding you…". |
| **Going** | Shown if ≥3 (includes viewer) | "You" row first | `Button variant="outline" size="lg"` **"Stop showing me"**, busy label "Removing…". Below: `text-xs text-muted` "[Edit name](/account)". |
| **Count hidden** (<3 opted in) | Omitted | Signed in: shown (1–2 rows) | Per the viewer state; no number anywhere, including the phone social line. |
| **Empty** (0 opted in) | Omitted | List omitted | Signed in: `text-sm text-muted` "No one's added themselves yet." then the viewer's action row. Signed out: only the sign-in prompt. |
| **Closed** (after the event) | "went" | Shown | No opt-in, no ticket prompt. If going: "Stop showing me" remains (withdrawal is always possible). Signed out: "Sign in to see who went." |
| **Mutation error** | — | — | `Notice tone="danger" role="alert"` above the action button: "Couldn't update that. Try again." Button re-enabled. |

Rules:
- Show more loading: button `disabled`, label "Loading…". On error, it stays and a
  `Notice tone="danger"` "Couldn't load more names." appears above it.
- Button pills are `btn-lg` (48px) below `lg`; at `lg` use md size with `min-h-11` (44px).
- Hover: pills per `.btn-outline`. Links underline 2px on hover (`hover:decoration-2`).
- `focus-visible`: global 2px ring, 3px offset. Focusable `li`/anchors inside the aside use
  `outline-offset-2`.
- Disabled: `.btn:disabled` opacity 0.5 (demo button uses its own muted fill as above;
  disabled controls are exempt from contrast minimums).

### 5.2 Opt-in form (inside `WhosGoingPanel`, eligible first-time only)

A disclosure, not a modal. Opening it sets `data-wg-expanded` (§3) and moves focus to the
display name input. `<form id="wg-form" aria-labelledby="wg-form-title" noValidate className="flex flex-col gap-5">`.

1. `<p id="wg-form-title" className="text-sm font-semibold">Add yourself to who's going</p>`
2. `Field label="Display name" htmlFor="wg-name" hint="1–40 characters. A first name and initial works well, like Mia T."`
   `<input id="wg-name" className={fieldClass} maxLength={40} autoComplete="nickname" required aria-describedby="wg-name-hint wg-name-count">`.
   Counter `<p id="wg-name-count" className="text-xs text-muted tabular-nums">{n}/40</p>`
   right-aligned under the input (not a live region).
3. Age checkbox: `<label className="flex min-h-11 items-center gap-3 text-sm">` wrapping
   `<input type="checkbox" className="size-5 shrink-0" required>` + "I'm 18 or older".
4. Consent paragraph `text-sm leading-5` (id `wg-consent`, referenced by the submit's
   `aria-describedby`), copy (proposed; needs product/legal sign-off):
   > People signed in to Sheltüh will see your display name and initials on this event's
   > page. People who aren't signed in only see how many are going. We never show your
   > email or ticket details. You can remove yourself at any time, here or from your
   > account. [How we handle your information](/privacy)
5. Actions `flex flex-col gap-3 sm:flex-row`: submit `Button variant="solid" size="lg"`
   "Show me as going" (busy: "Adding you…", `disabled`, form `aria-busy`), and
   `Button variant="outline" size="lg"` "Cancel" (closes, focus returns to "Add yourself").

Validation (on submit, client and server; server wins): name trimmed length 1–40
("Enter a display name." / "Keep it to 40 characters or fewer."); checkbox required
("Confirm you're 18 or older to be shown."). Errors render as `text-sm text-danger` under
the control, with `aria-invalid` and `aria-describedby` pointing at them; focus moves to the
first invalid control. Server `fieldErrors.displayName` maps to the name field.

### 5.3 `EventDetailsView.tsx` changes

- Insert the `#whos-going` wrapper + `WhosGoingPanel` between the `dl` and `#tickets`.
- Aside class gets `lg:has-[[data-wg-expanded]]:static`.
- Key-facts paragraph gets the phone social line (§3). It needs the count, so it is
  rendered by a small `WhosGoingSummaryLink` client component sharing the panel's data
  (one fetch, via a shared hook or lifting the fetch into a context). No second request.
- The main-column `DemoNotice` is unchanged.

### 5.4 `/account` page (new: `app/account/page.tsx` + `components/account/AccountSettings.tsx`)

Layout copies `app/dashboard/page.tsx`: `mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12
sm:px-8 sm:py-20`, `h1.display-lg` "Account". Metadata title "Account — Sheltüh".

Sections, each a `Panel`:

1. **"Signed in as"**: `text-base` email (read-only, from `useAuth().email`).
2. **"Who's Going profile"**
   - Intro `text-sm text-muted`: "This is the name people see when you add yourself to an
     event's guest list."
   - Form: same `Field` + counter + validation as §5.2 (id `account-name`). Submit
     `Button variant="solid" size="lg" className="w-full sm:w-auto"` "Save name" (busy
     "Saving…"). Success: `Notice role="status"` "Saved. Events you've joined now show
     {name}." shown under the button until the input changes again.
3. **"Delete your profile"**
   - `text-sm`: "Removes your display name and takes you off every event's Who's Going
     list. Your tickets and account aren't affected."
   - `Button variant="danger" size="lg"` "Delete profile" → inline confirm (no modal):
     a `div role="group" aria-labelledby="delete-confirm-text"` with
     `p#delete-confirm-text text-sm font-semibold` "Delete your Who's Going profile?"
     and a row: `Button variant="danger" size="lg"` "Yes, delete" + `Button variant="outline" size="lg"` "Cancel".
     Focus moves to "Cancel" on open (safe default); Cancel returns focus to "Delete profile".
   - After delete: the whole Profile + Delete area is replaced with `Notice role="status"`
     "Your profile is deleted. You're no longer shown on any event." and focus moves to it
     (`tabIndex={-1}`).
   - Footer line `text-xs text-muted`: "To delete your whole account, see our [Privacy Policy](/privacy)."

States:
| State | Render |
| --- | --- |
| Demo (`!auth.configured`) | `DemoNotice` "Accounts aren't available in this demo." + the profile form with the sample name "Mia T.", all controls `disabled`. No delete section. |
| Auth loading | `text-sm text-muted` "Loading your account…" |
| Signed out | `EmptyState title="Sign in to manage your account"` with `ButtonLink size="lg" href="/login?next=/account"` "Sign in". |
| Loading profile | "Loading your profile…" under section 2 heading. |
| Load error | `Notice tone="danger" role="alert"` "Couldn't load your profile." + outline "Try again". |
| No profile yet | Section 2 intro + `text-sm` "You haven't added yourself to an event yet. Your profile is created the first time you do." No form, no delete section. |
| Has profile | Sections 2 and 3 as above. |
| Save / delete error | `Notice tone="danger" role="alert"` under the relevant button; control re-enabled. |

Entry points: an "Account" link in `AuthNavLinks` (signed-in, between "My events" and
"Sign out", same `linkClass`) and the "Edit name" links in the panel.

## 6. Motion

| What | Behaviour | Reduced motion |
| --- | --- | --- |
| Rows added by Show more, the "You" row on opt-in | `fade-in`: opacity 0→1, 150ms ease-out, no movement | None |
| Form open / confirm open / row removal | Instant | Instant |
| Jump to `#whos-going` / `#tickets` | Existing smooth scroll | Instant (existing) |
| Pills | Existing 150ms colour transition | Unchanged |

Add inside the existing `@media (prefers-reduced-motion: no-preference)` block in
`app/globals.css`:

```css
@keyframes fade-in { from { opacity: 0; } }
.fade-in { animation: fade-in 0.15s ease-out both; }
```

No count-up animation on the numeral, no avatar stacking or sliding.

## 7. Accessibility

- Landmarks: the panel is a `section` (from `Panel`) labelled by its h2 (add `aria-labelledby`
  support to `Panel` via an optional `titleId` prop, or wrap it). Names are a real `ul`.
- Every control has a visible text label; no icon-only buttons. Targets ≥44px everywhere
  (pills `min-h-11`/`btn-lg`, checkbox label row `min-h-11`, inline links `min-h-11`).
- Live-region announcements (the panel's `sr-only` `role="status"`):
  - Opt-in success: "You're now shown as going as {name}."
  - Opt-out success: "You're no longer shown as going."
  - Show more: "{k} more names shown." End of list: "That's everyone."
  - Load error: "Couldn't load who's going."
- Focus management:
  - After opt-in: focus the viewer's "You" `li` (`tabIndex={-1}`, `outline-offset-2`).
  - After opt-out: focus the button that replaces "Stop showing me" ("Show me as going",
    or the closed-state text if the event is over, made `tabIndex={-1}`).
  - After Show more: focus the first newly added `li` (`tabIndex={-1}`).
  - Form open: the name input. Form cancel: "Add yourself". Validation: the first invalid control.
  - Never move focus on initial load or on background refresh.
- Count row reads as one phrase: numeral and label in one `p` ("14 going").
- The initials avatar is `aria-hidden`; the name text is the accessible name.
- Truncated names: `truncate` only, never `…` in the text; add `title={displayName}` for
  mouse users.
- Error messages are text + colour (never colour alone).

## 8. Dependencies and out of scope

**Backend (blocking for live mode):**
- **Ticket ownership is not linked to accounts.** `orders` has `buyer_email` only (no user
  id), so "has a ticket" can't be determined today. Needs either `orders.buyer_user_id` set
  at checkout when signed in, or a verified-email match. Decision for architect/backend.
- New tables and API: a social profile (display name 1–40, 18+ attestation timestamp,
  consent timestamp and copy version) and per-event opt-ins. Endpoints via `lib/api/*`:
  `GET /api/events/[id]/whos-going?cursor&limit` → `{ count: number | null (null when <3),
  names: { id, displayName, initials }[] (empty for signed-out callers), nextCursor,
  viewer: { state: "signed-out" | "no-ticket" | "eligible" | "going", displayName? },
  closed: boolean }`; `POST`/`DELETE` opt-in; `GET`/`PATCH`/`DELETE /api/me/profile`.
  Profile delete must remove all opt-ins atomically (`private.*` function).
- `closed` computed server-side (after `endsAt`, or `startsAt` + a product-defined window).
- Security review: names must never reach signed-out callers or caches (`Cache-Control:
  private, no-store`); display names need length and control-character validation.

**Frontend behaviour changes (proposals for the manager):**
- `LoginForm` always `router.push("/dashboard")`. Sign-in links here need `?next=` support
  (same-origin relative paths only).
- New `/account` route and the "Account" nav link.
- Demo sample names: a deterministic `lib/sample-attendees.ts` (fictional first name +
  initial, ~18 per event, seeded by event id), used only when `demo`.

**Legal/product:** consent copy (§5.2) and a "Who's Going" section in `/privacy` need
sign-off before launch. The 18+ checkbox is a self-attestation; confirm that satisfies the
policy intent.

**Out of scope:** profile photos, friends/following, notifications, showing which
ticket type someone holds, organiser-side attendee lists, the phone buy bar content (unchanged).
