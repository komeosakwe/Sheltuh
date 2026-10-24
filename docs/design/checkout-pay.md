# Checkout pay page: `/checkout/pay?order=…` (embedded Stripe Checkout)

Builds on Brand Direction One §2.4/§2.5 (radii, borders, spacing), §6.8 (all-inclusive pricing) and §6.9 (checkout: quiet, black, total loudest), and on the architect's Embedded Checkout plan (`OrderPaymentLookup`, `getOrderPayment`). No new tokens: everything below uses the existing `app/globals.css` variables and utilities.

## 1. Principles

1. **Two voices, one page.** Ours (summary, copy, states) and Stripe's (the white form). Ours stays in the brand tokens, Stripe's stays white. We never try to restyle the iframe, and nothing of ours overlaps it.
2. **The total is the loudest number on the page.** It's all-inclusive (ACL), the largest figure in the summary, and visible without opening anything at every width. Partials come after it, smaller and muted.
3. **Quiet.** No orange, no `font-display`, no `display-lg`, no photography, no push-in, no badges. The only motion is `DotsLoader`. Black solid buttons only.
4. **The summary comes first.** Phones read: what am I buying → how much → pay. Desktop puts the same order left to right.
5. **Every state can be left safely.** Each one says whether money moved ("You haven't been charged") and has a way back.

## 2. Tokens (usage only, no `globals.css` changes)

| Role | Spec |
| --- | --- |
| Steps | `ol.eyebrow` (Plex Mono 500 12/16, 0.02em, uppercase), `flex flex-wrap gap-x-3`. Current step `text-foreground`, others `text-muted`, "→" separators `aria-hidden` |
| h1 | `display-md` (700, 20/24 → 22/28 sm → 24/30 lg, -0.02em, sentence case), `tabIndex={-1}` |
| Event title (summary) | `font-heading text-lg leading-6` (18/24 700, -0.025em), `break-words` |
| Date, venue | `text-sm text-muted` (14/20) |
| Line name | `text-sm font-semibold` 14/20; quantity × unit underneath as `meta text-muted` |
| Line amount | `text-sm tabular-nums text-foreground` 14/20 |
| Total label / value | `text-lg leading-6 font-bold` / `text-xl leading-7 font-bold tabular-nums` (exactly the `CheckoutConfirmation` "Total paid" row) |
| Fee note, hold line, legal | `text-xs text-muted` 12/16 |
| Links | `text-foreground underline underline-offset-4`. Standalone links `inline-flex min-h-11 items-center` |
| Card | `rounded-card border border-foreground bg-card` (12px, 1px black or white by theme) |
| Rules | Between lines `border-t border-surface-border`; above Total `border-t border-foreground` |
| Spacing | Only 4/8/12/16/20/24/32/48/64 (`1,2,3,4,5,6,8,12,16`) |
| Contrast | Muted on card: 5.65:1 light, 6.90:1 dark. Foreground 21:1 / 18.9:1. Danger `#b3261e` 6.5:1 on white, `#ff6b5e` 7.5:1 on black. All AA |

**Dark theme around the white iframe.** The form slot is `data-surface="paper"`, so it stays white with a black 1px border in both themes. On the black Dark page the white card's own edge carries the separation. Nothing inside our summary changes for this: it follows the page theme.

**Stripe branding** (owner, Stripe Dashboard → Settings → Branding; **no `branding_settings` in code**): background `#ffffff`, brand and accent colour `#000000` (black button, white label, 21:1), shapes "Rounded" (never Pill), font the plainest option on offer (Instrument Sans isn't available), icon the Sheltüh U mark on white. Set it for both test and live mode.

## 3. Grid and layout

The page shell is the same as `/checkout/success`: `mx-auto max-w-6xl px-5 sm:px-8`, content `pt-6 pb-16 sm:pt-8 lg:pt-12`.

**DOM order** (it's also the phone order and the tab order):
1. Back link
2. Steps `ol`
3. h1
4. Summary card (`<section aria-labelledby="order-summary">`)
5. Seated hold line
6. Form slot (`<section aria-labelledby="payment-details">`, with an `sr-only` h2 "Payment details")
7. Legal line

**Below lg (320–1023px):** one column, `flex flex-col gap-6`, capped at `max-w-2xl` (left-aligned, as on the success page). The form slot is full column width. At 320px that's 280px inside the gutters; Stripe's form reflows to fit, so there's no sideways scroll.

**lg and up (≥1024px):**
- Items 1–3 span the full width above a `grid grid-cols-12 gap-12 items-start` (`mt-8`).
- Summary is `col-span-5 sticky top-24`. The 96px clears the 70px header with 24px to spare.
- Form slot and legal line are `col-span-7`. The slot is capped at `max-w-xl` (576px) so Stripe stays in its single-column layout.

**Form slot:** `rounded-card border border-foreground bg-card overflow-hidden min-h-144` (576px, a documented dimension). The minimum height stops the layout jumping while Stripe mounts. It doesn't apply once the iframe has a height (drawn, not merely inserted), nor in the failed state. No padding: Stripe pads its own content.

## 4. Imagery

None. This page shows no event photo and no `EventArt`, so there's no fallback to specify and no image-pipeline dependency. The event is identified by its title, date and venue.

## 5. Components

### 5.1 `app/checkout/pay/page.tsx`
- Metadata: title `Checkout — Sheltüh`, `robots: { index: false, follow: false }`, `referrer: "no-referrer"` (as `/checkout/cancelled`).
- The `<Suspense>` fallback is the Loading state (§5.4).

### 5.2 `components/checkout/CheckoutPayment.tsx` (state machine, page copy)

**Back link** (top, `text-sm` with a 16px left-arrow icon `aria-hidden`, gap 8px, min-h-11). The target depends on the order:

| Order | Label | `href` |
| --- | --- | --- |
| General admission | Back to the event | `/events/{eventSlug}` |
| Seated | Change seats | `/events/{eventSlug}/seats` |
| No `eventSlug` (unlisted) | Back to Sheltüh | `/` |

A seated buyer going back releases the held seats. That's the existing `SeatPicker` behaviour, and the hold line says so.

**Steps:**
- General admission: `1 Choose tickets → 2 Pay → 3 Tickets by email`
- Seated: `1 Choose seats → 2 Pay → 3 Tickets by email`

Step 2 is current. The current step's `li` gets `aria-current="step"`.

**h1:** `Pay for your tickets` in loading, open and Stripe-failed. Each terminal state has its own h1 (table below).

**Seated hold line** (`open` and seated only), between the summary and the form: `Your seats are held until {h:mm am/pm} Melbourne time. Going back releases them.` Melbourne time like the event's own times, and said so for a device in another zone. It's static, not a ticking countdown (WCAG 2.2.1). When `expiresAt` passes, re-fetch; the answer should be the closed state. The timer re-arms after every `open` answer, never sooner than 5 s, so a clock that runs ahead still converges.

**Legal line** under the form slot (`mt-4 text-xs text-muted`):

> By paying you agree to the [Purchase Terms](/purchase-terms). See our [Privacy Policy](/privacy). Card details go straight to Stripe, our payment provider, and never reach Sheltüh.

**States** (exact copy). "Way out" is a `ButtonLink` `variant="solid" size="lg"`, `w-full sm:w-auto`, using the back-link target and label, unless stated otherwise.

| State | Trigger | h1 | Body (`text-sm text-muted max-w-md`) | Way out |
| --- | --- | --- | --- | --- |
| Loading | Fetching `getOrderPayment` | Pay for your tickets | Summary skeleton (`bg-surface rounded-badge` blocks: 1 line 24px, 2 lines 16px, total 28px) plus `DotsLoader announce label="Loading checkout"` in the form slot | – |
| Open | `status:"open"` | Pay for your tickets | Summary plus the form. While Stripe.js loads or the iframe mounts, the slot shows a centred `DotsLoader announce label="Loading the payment form"` | Back link |
| Payment form failed | `getStripe()` rejects or resolves null; `createEmbeddedCheckoutPage` rejects; or the form isn't drawn within 20 s | Pay for your tickets | Summary stays. In the slot (`p-5`, no minimum height): `Notice tone="danger" role="alert"` "The payment form didn't load. Check your connection. If you use a content blocker, allow js.stripe.com, then try again. You haven't been charged." Then a `btn-outline` (md, `min-h-11`) "Try again", which re-fetches the checkout and mounts a fresh form (any earlier Stripe instance is destroyed first) | Back link |
| Not configured | Live mode, no publishable key | Card payments aren't available right now | "You haven't been charged. Try again later, or email support@sheltuh.com.au." (mailto link) | Back link target. Never loads Stripe |
| Demo | `!isApiConfigured` | Checkout isn't available in this demo | "This is a local prototype. No payment information is collected and no tickets are issued." | "Browse events" → `/`. Never loads Stripe |
| Closed | `status:"closed"` | This checkout has closed | GA: "You haven't been charged. Start again from the event page to book." Seated: "You haven't been charged, and the seats held for you have been released. Choose seats to book again." | GA "Back to the event", seated "Choose seats again" |
| Sold out | `status:"sold_out"` | These tickets have just sold out | GA: "Someone else booked the last ones while this checkout was open. You haven't been charged." Seated: "Some of your seats were booked by someone else while this checkout was open. You haven't been charged. Choose other seats to continue." | GA "Back to the event", seated "Choose other seats" |
| Processing / done | `status:"processing"` or `"done"` | – | `DotsLoader announce label="Taking you to your order"`, then `router.replace("/checkout/success?session_id={order}")` | – |
| Not found | No `order` param, or a 404 | We couldn't find that checkout | "The link may be incomplete. If you were charged, your tickets are on their way to your email." | "Back to Sheltüh" link → `/` |
| Not ready | 409 | Pay for your tickets | `Notice tone="danger" role="alert"` "This checkout is still being set up." plus `btn-outline` "Try again" | Back link |
| Rate limited | 429 | Pay for your tickets | `Notice tone="danger" role="alert"` "Too many tries — wait a minute, then try again. You haven't been charged." plus `btn-outline` "Try again" | Back link |
| Network error | Any other failure | Pay for your tickets | `Notice tone="danger" role="alert"` "Couldn't load checkout right now. You haven't been charged." plus `btn-outline` "Try again" | Back link |

Terminal states (not configured, demo, closed, sold out, not found) drop the steps and the summary. They use the same left-aligned `flex flex-col items-start gap-3` block as `StateMessage` in `CheckoutConfirmation`, with the way out at `mt-3`.

### 5.3 `components/checkout/OrderPaymentSummary.tsx`

Card `p-4 sm:p-5`, `flex flex-col gap-4`:
1. `h2#order-summary` with the event title (18/24 700). Under it, 4px apart, the `formatEventDateTimeRange(startsAt, endsAt)` line, then "{venueName}, {suburb}" (14/20 muted). Leave out whichever is absent.
2. **Lines:** a `ul`, rows `flex justify-between gap-4 py-3` with `border-t border-surface-border` (none on the first).
   - Left: `{ticketTypeName}`, and under it in `meta`: `{quantity} × {formatAud(unitTotalCents)} incl. fee` ("incl. fee" only when that line's `buyerPaysFee`). A free line says `{quantity} × Free`.
   - Seated: under that, one `meta` line per seat label, formatted as `TicketStub` does via `lib/seating/format.ts`.
   - Right: `formatAud(lineTotalCents)`, or "Free".
3. **Total:** `flex items-baseline justify-between gap-4 border-t border-foreground pt-3`. "Total" on the left, `formatAud(totalCents)` on the right (§2). **The total is never inside the collapsed region.**
4. **Fee note** (`text-xs text-muted`, `mt-1`, after the total): `Includes {formatAud(buyerFeeCents)} in booking fees.` When `buyerFeeCents === 0`: `No booking fee.`. Any further breakdown is never larger than this, and this note never comes before the total.

**Phones (< lg): compact.**
- Item 2 sits in a region that's collapsed by default.
- A toggle `button` (`lg:hidden`, `min-h-11 w-full flex justify-between items-center text-sm`, `aria-expanded`, `aria-controls="order-lines"`) sits between the event block and the Total. Labels: `Show {n} ticket(s)` / `Hide tickets`, with a 16px chevron that rotates 180° (no transition).
- The region is `hidden lg:block` when collapsed and `block` when open. From lg the toggle isn't rendered and the lines always show.
- In a seated order the toggle label is `Show {n} seat(s)`.

### 5.4 `components/checkout/EmbeddedPaymentForm.tsx`
- Wait for `getStripe()` before mounting `EmbeddedCheckoutProvider` (keyed by order id) and `EmbeddedCheckout` inside the slot.
- Don't put `tabIndex`, `aria-hidden` or `inert` on the slot or its ancestors. Stripe's iframe gets its own title; keep it in natural tab order after the summary toggle and before the legal links.
- Stripe draws its own compact order summary at the top of the iframe. Its total must match ours exactly; visual-qa checks this. Don't try to hide it.

### 5.5 `components/CheckoutConfirmation.tsx` (return page): new and changed states

These use the existing `StateMessage` layout. Actions are a `ButtonLink` `solid lg` and then a `linkClass` link, in a `flex flex-col sm:flex-row gap-3 sm:items-center` row.

| State | h1 | Body | Actions |
| --- | --- | --- | --- |
| `open` (stop polling) | Payment not completed | "You haven't been charged. Your checkout is still open, so you can try again." Seated adds: " Your seats are held until {h:mm am/pm} Melbourne time." | "Return to payment" → `/checkout/pay?order={id}`; link "Back to the event" (`/` and "Back to Sheltüh" if no slug) |
| `processing` (polling) | Keep the current `LoadingState` "Confirming your order…" and "This only takes a moment." | – | – |
| `processing` (after `MAX_POLLS`, replacing today's error) | Your payment is processing | "Some payment methods take a little longer to clear. We'll email your tickets as soon as it does; you don't need to keep this page open. You won't be charged twice." Muted, **not** danger | Link "Back to Sheltüh" |
| `closed` | This checkout has closed | "You haven't been charged. Start again from the event page to book." | Link "Back to the event" |
| `sold_out` | These tickets have just sold out | As §5.2 GA or seated | As §5.2 |

### 5.6 Copy replacing "Pay on Stripe" (exact strings)

| File | Old | New |
| --- | --- | --- |
| `components/TicketSelector.tsx:157` | `"Pay on Stripe"` | `"Pay"` |
| `components/TicketSelector.tsx:440` | `"Redirecting to checkout…"` | `"Opening checkout…"` |
| `components/TicketSelector.tsx:468` | `"You'll pay securely on Stripe's own checkout page."` | `"You'll pay on the next page, in a secure form from Stripe, our payment provider."` |
| `components/seating/SeatedTicketsPanel.tsx:37` | `"Pay on Stripe"` | `"Pay"` |
| `components/seating/SeatPicker.tsx:582` | `…holds them for you while you pay on Stripe. You'll have ${…} minutes; if you don't finish, they're released.` | `` `Seats aren’t held while you choose. Pressing Checkout holds them for ${SEAT_HOLD.stripeMinutes} minutes while you pay. If you don’t finish, they’re released.` `` |
| `app/help/page.tsx:16-17` | `Paid tickets are paid securely on Stripe’s own checkout page.` | `You pay for paid tickets on our checkout page, in a secure form run by Stripe, our payment provider. Your card details never reach Sheltüh.` |

The busy labels "Holding your seats…" and "Booking…" are unchanged.

Tests to update (test-engineer): `tests/TicketSelector.test.tsx:404,423,539`. Spec docs to bring in line (doc owner): `brand-direction-one.md:551`, `seating.md:159,368`, `mobile.md:465`.

**Flag, not changed:** help page line 17 says "Free tickets are issued straight away with no payment step". Free bookings now go through an email confirmation step, so this is out of date. I'm proposing a fix to the manager, not making it here.

## 6. Motion and accessibility

**Motion:**
- Only `DotsLoader`, which already holds still under `prefers-reduced-motion: reduce`, where its label carries the state.
- No entrance animation (`rise`), no transitions on the disclosure, no smooth scroll to the form.

**Focus:**
- On first load, focus is left to Next's route announcer.
- After any **state change after mount** (open → closed or sold out, a successful retry, an error, the return page switching state), move focus to the h1. It has `tabIndex={-1}` and keeps the default `:focus-visible` ring.

**Live regions:**
- `DotsLoader announce` speaks the loading labels.
- When the iframe has a height (drawn, not merely inserted), a persistent `sr-only` `role="status"` says "Payment form ready".
- Errors use `role="alert"`. Don't announce the same message twice.

**Tab order:** Back link → summary toggle (phones) → Stripe iframe → Purchase Terms → Privacy Policy. Nothing is sticky over the form on phones, and the lg sticky summary never overlaps it (separate columns), so WCAG 2.4.11 is met.

**Targets:** the back link, toggle, buttons and standalone links are all ≥44px (`min-h-11`). The legal links are inline in a sentence, which WCAG 2.5.8 exempts, but they get `py-1` for comfort.

**Zoom:** at 320px and at 200% zoom, there's no sideways scroll and the total never truncates (`tabular-nums`, with the label wrapping rather than the amount).

## 7. Dependencies and out of scope

- **Backend:** depends on `OrderPaymentLookup` exactly as planned (summary fields, `seated`, `expiresAt`). No image pipeline is needed.
- **Owner:**
  - Stripe Dashboard branding (§2), in test and live.
  - The Privacy Policy line about Stripe's form loading on our checkout page (plan D6).
- **Out of scope:**
  - Restyling inside Stripe's iframe.
  - A live countdown timer.
  - Event imagery on checkout.
  - Changes to `/checkout/cancelled` (kept for legacy sessions).
  - The `TicketSelector` `pageshow` fix (behaviour, per the plan).
