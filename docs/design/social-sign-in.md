# Social sign-in: Continue with Apple / Google

Status: spec, 24 Oct 2026. Builds on `brand-direction-one.md` §7 (Auth), `theme-white-dark.md` and the architect's OAuth plan (PKCE redirect, `/auth/callback`, `NEXT_PUBLIC_AUTH_PROVIDERS`). Surfaces: `/login`, `/signup`, `/auth/callback`, `InlineReauth`, `/account`. No behaviour beyond the plan; the proposals are in §7.

**Sources.** Apple: the Sign in with Apple HIG (fetched copy, verified). Google: developers.google.com/identity/branding-guidelines **could not be reached** (DNS failure from this environment). Every Google value below is marked **(unverified)**. They come from memory of Google's 2023 guidelines, and the frontend must check them against the downloaded kit before shipping.

## 1. Principles

1. **Guest marks, house frame.** The two buttons follow their vendors' rules exactly. Everything around them (spacing, divider, notices, copy, focus) follows the house rules. Don't restyle brand marks to look like `.btn`, and don't let `.btn` styling leak into them.
2. **A matched pair that inverts with the page,** like `btn-solid`. On White both buttons are near-black; on Dark both are white. Equal size, equal weight, and never less prominent than the email Sign in button (Apple HIG: "no smaller than other sign-in buttons").
3. **One sign-in path per row, stacked.** Full width at every breakpoint, so both buttons and the divider are visible without scrolling at 320×568.
4. **Our words, never the provider's.** Errors map to fixed copy, and `error_description` is never rendered.
5. **No orange, no new motion.** The auth pages stay calm (BD1 §7). The focus ring is the global foreground ring.

## 2. Tokens (`app/globals.css`)

**Colour.** Add these to `:root`, and the Dark values to `@media screen { [data-theme="dark"] }`. Don't re-scope them in `[data-surface=*]`; the buttons only appear on page backgrounds.

| Variable | White theme | Dark theme | Source |
|---|---|---|---|
| `--apple-fill` / `--apple-ink` | `#000000` / `#ffffff` (Apple **Black**) | `#ffffff` / `#000000` (Apple **White**) | HIG: logo and title are both black or both white. Black goes on light backgrounds and White on dark. White-with-outline isn't used. |
| `--google-fill` / `--google-stroke` / `--google-text` | `#131314` / `#8e918f` / `#e3e3e3` (Google **Dark**) | `#ffffff` / `#747775` / `#1f1f1f` (Google **Light**) | (unverified) Google theme values. Neutral `#f2f2f2` isn't used. |

**Contrast, checked:**
- Apple title: 21:1 in both themes.
- Google title: `#e3e3e3` on `#131314` is about 14.5:1; `#1f1f1f` on `#ffffff` is about 16.5:1.
- Button boundary against the page:
  - Apple on White: 21:1.
  - Google stroke `#8e918f` on `#ffffff`: about 3.2:1 (meets 3:1 for non-text).
  - Both buttons on Dark (white fills on `#000`): 21:1.

**Type.**
- Add `Roboto` weight 500, `subsets: ["latin"]`, `display: "swap"`, `preload: false`, `variable: "--font-roboto"` to `app/fonts.ts`. Apply `.variable` on the OAuthButtons root only.
- Add `--face-oauth: var(--font-roboto), Roboto, "Helvetica Neue", Arial, sans-serif;`.
- Google requires Roboto Medium (unverified). Apple allows any font. Both titles use it so the pair reads as one set.
- Sentence case, tracking 0, no `uppercase`.

| Role | Size / line-height | Rule |
|---|---|---|
| Apple title | `calc(3rem * 0.43)` = 20.64px / 1 | HIG: the title is 43% of the button height. This is the one sanctioned off-scale size. |
| Google title | 17px / 24px (unverified) | Google's 40px proportions (Roboto Medium 14px) scaled ×1.2 to 48px. If the kit forbids scaling, keep the 48px box and use 14px/20px. |
| Divider "or" | `eyebrow` 12/16 Plex Mono 500, 0.02em, uppercase | House |
| Notes, hints | `text-xs leading-4` 12/16 Instrument | House (LegalNote) |

**Shape and spacing.**
- Height `min-h-12` (48px), `w-full`, `rounded-control` (8px). The HIG allows matching the UI's radius.
- If Google's kit fixes rectangular buttons at 4px, use `rounded-badge` on **both** buttons (unverified).
- Gap between the buttons: `gap-3` (12px). That's at least 1/10 of the height, which the HIG requires around the button.
- Spacing comes only from the house scale.

**Add to `@layer components`:**
```
.btn-oauth { position:relative; display:flex; width:100%; min-height:3rem; align-items:center; justify-content:center;
  border-radius:var(--radius-control); font-family:var(--face-oauth); font-weight:500; letter-spacing:0; text-transform:none; }
.btn-oauth::after { content:""; position:absolute; inset:0; border-radius:inherit; background:currentColor; opacity:0; pointer-events:none; }
.btn-oauth-apple { background:var(--apple-fill); color:var(--apple-ink); border:0; padding-inline:0 8%; font-size:calc(3rem * .43); line-height:1; }
.btn-oauth-google { background:var(--google-fill); color:var(--google-text); border:1px solid var(--google-stroke);
  padding-inline:1rem; gap:0.75rem; font-size:1.0625rem; line-height:1.5rem; }
@media (hover:hover) { .btn-oauth:hover:not([aria-disabled="true"])::after { opacity:.08 } }
@media (prefers-reduced-motion:no-preference) { .btn-oauth::after { transition:opacity 150ms ease-out }
  .btn-oauth:active:not([aria-disabled="true"]) { transform:translateY(1px) } }
.btn-oauth[aria-disabled="true"] { cursor:progress }
```
- Apple's right padding of 8% (of the button's width, because it's `w-full`) is the HIG's minimum margin to the right of the title.
- Busy and disabled states never grey the buttons (their colours are fixed). See §5.

## 3. Grid and layout

Use the existing auth shell, unchanged: `mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20`, stack `flex max-w-md flex-col gap-8`, left-aligned at 1024+.

| Width | Content width | Button width | Fit check (Apple title about 185px plus logo file about 44px) |
|---|---|---|---|
| 320 | 280px | 280 | Right margin needs 22.4px; there's about 25px. OK. |
| 375 | 335px | 335 | OK |
| 1024+ | 448px (`max-w-md`) | 448 | OK |

Never put the buttons side by side.

**Order on `/login` and `/signup`:**
1. PageHeader
2. **OAuthButtons** block (`flex flex-col gap-8`), made of:
   - the pair (`flex flex-col gap-3`): **Apple, then Google**
   - the notice/status slot
   - the legal line
   - the divider
3. The email form. On `/login`, the existing LegalNote stays below it.

**Above the fold at 320×568:**
- `/login`: the pair ends at about y=315.
- `/signup` (with its intro): about y=475.

**Why Apple first:**
1. Most people come from Instagram, and Google refuses sign-in in in-app webviews. The top button should be one that works there.
2. iPhone is the majority platform for this audience in Australia.
3. It meets the HIG's prominence rule beyond doubt.

As far as we know, Google sets no order rule (unverified). Keep the order fixed; it doesn't change by device.

If only one provider is enabled, render that button alone, then the divider. If none is enabled, or Supabase isn't configured, render nothing: no divider, no line.

## 4. Imagery and brand artwork

**Apple logo**
- Use **official artwork only**, from Apple Design Resources (developer.apple.com/design/resources → Sign in with Apple, "logo + text" files, SVG).
- The owner or frontend downloads it. Inline the SVG path data unmodified, with the logo file's height equal to the button's 48px. Don't crop it, and don't add to or remove its built-in padding.
- `fill="currentColor"` resolves only to `#000000`/`#ffffff`, which is the same as Apple's black and white files.
- Never draw your own Apple logo, and never use the logo by itself as the button.

**Google G**
- Use **official artwork only**: Google's standard multicolour "G" from the Sign-In branding kit (download link on developers.google.com/identity/branding-guidelines).
- 24×24px (unverified ×1.2 scale), colours unmodified. Use the kit's dark-theme asset on the Dark fill, including any backing Google specifies.
- Never recolour it, use a monochrome version, or recreate it.

**Both logos**
- `aria-hidden="true" focusable="false"`.
- Don't commit the zip files. Record each source URL and download date in a comment above each inlined SVG.
- These marks appear nowhere else (not `/account`, not the footer).

## 5. Components

**`components/auth/OAuthButtons.tsx`** (new; props `next?: string`, `context: "login" | "signup"`)

Anatomy:
- Buttons are real `<button type="button">` elements, outside any `<form>`.
- Accessible name equals the visible title: **"Continue with Apple"** and **"Continue with Google"**. These are the only titles; they're right on both pages because one tap signs you in or creates the account.
- Apple: `.btn-oauth .btn-oauth-apple` containing logo then title, centred.
- Google: `.btn-oauth .btn-oauth-google` containing G then title, centred.

States:

| State | Behaviour |
|---|---|
| Hover (`hover:hover`) | 8% `currentColor` overlay. The fill itself never changes. |
| Focus-visible | Global `outline: 2px solid var(--foreground); outline-offset: 3px`. That's black on White and white on Dark, separated from the button by a 3px gap of page colour. Never orange; don't override it. |
| Active | 1px nudge (no-preference only). |
| Busy (after a click, before the redirect) | **Both** buttons get `aria-disabled="true"`, keep their colours and keep focus. Clicks are ignored. The status slot shows `DotsLoader` with `announce`, label **"Opening Apple"** or **"Opening Google"** (DotsLoader adds the "…"). |
| Back/forward-cache restore (`pageshow` with `persisted`) | Reset busy and clear the status. |
| Error before the redirect | `Notice tone="danger" role="alert"`: **"Couldn't open Apple sign-in. Check your connection and try again."** (or Google). Busy resets; focus stays on the button. |
| Disabled | Not used. An unavailable provider isn't rendered. |
| Loading / empty | Nothing renders until `auth.configured` is known. |

**In-app browser, Google only.** The button renders normally. A click doesn't redirect. Instead it shows `Notice tone="info" role="status"` in the slot, and focus stays on the button:
- iOS: **"Google sign-in doesn't work inside this app's browser. Open this page in Safari, or continue with Apple or email."**
- Android: the same with **"Chrome"**.
- Other: **"…in your browser…"**.
- With Apple disabled: **"…or continue with email."**

Apple follows its normal path in in-app browsers.

**Legal line.** Directly under the pair, in the LegalNote style (12/16 muted, links `text-foreground underline underline-offset-4`):
> **"Continuing with Apple or Google signs you in, or creates an account if you're new. How we handle your details: Privacy Policy · Terms of Use."**

With one provider, name only that one. Implement it as a `lead` prop on `LegalNote` (default "How we handle your details:"). Explicit "you agree to the Terms" wording waits for legal.

**Divider.** `<div class="flex items-center gap-4">` containing:
- `<span aria-hidden class="h-px flex-1 bg-surface-border">`
- `<span class="eyebrow text-muted">or</span>`
- `<span aria-hidden class="h-px flex-1 bg-surface-border">`

The rule is a decorative hairline, so `surface-border` is correct. Muted text is 5.65:1 on White and 7.87:1 on Dark.

**`LoginForm.tsx`.** Only when at least one provider renders, add the password field's `hint` (AuthField's existing slot, `text-xs text-muted`, wired into `aria-describedby`):
> **"Signed up with Google or Apple? Use that button — there's no password."**

With one provider, name only that one.

**`/auth/callback` (`OAuthCallback.tsx`)**
- Shell as in §3.
- `PageHeader flush eyebrow="Account"`, with `titleRef` used on error.
- Body: `<p class="max-w-md text-base leading-6 text-muted">`.
- Actions: `flex flex-col gap-3 sm:flex-row`, each `w-full sm:w-auto`:
  - `ButtonLink variant="solid" size="lg"`: **"Back to sign in"** → `withNext("/login", next)`.
  - `ButtonLink variant="outline" size="lg"`: **"Use email instead"** → `withNext("/login", next)` + `#email`.
- No retry button.
- On error, focus moves to the h1.

| Case | h1 (`display-lg`) | Body | Actions |
|---|---|---|---|
| Working | "Signing in" | `DotsLoader announce label="One moment"` | none |
| `access_denied`, `user_cancelled_authorize` | "Sign-in cancelled" | "Nothing has changed. Try again, or sign in with your email." | both |
| `user_banned` | "This account can't sign in" | "If you think this is a mistake, email support@sheltuh.com.au." (`mailto:` link, underlined) | Back to sign in |
| `signup_disabled` | "New accounts are paused" | "We're not taking new sign-ups right now. If you already have an account, sign in the way you did before." | both |
| `provider_email_needs_verification` | "Verify your email first" | "Your Google or Apple account's email isn't verified yet. Verify it with them, then try again, or sign in with your email." | both |
| `pkce_code_verifier_not_found` | "Start again in this browser" | "Sign-in started in a different browser or app, so we can't finish it here. Go back to sign in and choose Apple or Google again." | both |
| `flow_state_expired`, `flow_state_not_found`, `bad_code_verifier` | "This sign-in has expired" | "It took too long, or it was already used. Go back to sign in and try again." | both |
| Network failure | "Couldn't reach Sheltüh" | "Check your connection, then go back to sign in and try again." | both |
| No code and no error | "This sign-in link didn't work" | "Go back to sign in and choose how you'd like to continue." | both |
| Any other code | "Something went wrong signing in" | "Go back to sign in and try again." | both |
| Demo (not configured) | "Accounts aren't configured" | "Accounts aren't configured in this environment yet, so Apple and Google sign-in aren't available." | outline "Browse events" → `/events` |

The h1s are uppercase via `display-lg`, as on every auth page. No red headings; the words carry the error.

**`InlineReauth.tsx`.** Only when a provider is enabled. Add a line under the Sign in button: `<p class="text-xs leading-4 text-muted">`
> **"Signed in with Google or Apple?"** followed by the link **"Sign in in a new tab"**

- The link: `/login`, `target="_blank" rel="noopener"`, `inline-flex min-h-11 items-center text-foreground underline underline-offset-4`.
- With one provider, name only that one.
- After the link is clicked, an `aria-live="polite"` line `text-xs text-muted` reads **"Waiting for you to sign in in the other tab."**
- It clears on `onSignedIn`. The different-email error reuses the existing `text-xs text-danger` alert.

**`AccountContent.tsx` (optional).** In the "Signed in as" Panel, under the email, as the first line of the `gap-1` stack: `<p class="text-sm text-muted">`
> **"Sign-in methods: Email and password, Google"**

- Build it from `app_metadata.providers`: `email` → "Email and password", `google` → "Google", `apple` → "Apple", joined with ", " in that order.
- Text only, no logos.

## 6. Motion

- The only new motion: the hover overlay (opacity 150ms ease-out) and the 1px press, both under `prefers-reduced-motion: no-preference`.
- `DotsLoader` already stops with reduced motion; its label carries the state.
- No `rise` on the new blocks (BD1 §7: auth has no motion). The redirect itself is the feedback.

## 7. Dependencies, proposals, out of scope

**Owner / frontend**
- Download the official Apple and Google artwork (§4). It's a build blocker; no placeholder logos may ship.
- Verify every "(unverified)" Google value against the kit: theme hex, Roboto size, G size, padding, radius, scaling, dark-theme G backing.

**Font**
- Roboto 500 through `next/font/google`. That's no npm dependency; it's downloaded at build time, about 15–20 KB, and loaded only on pages that render OAuthButtons.

**Proposals for the manager (behaviour)**
- A `lead` prop on `LegalNote`.
- `#email` on "Use email instead". Native fragment scrolling only; focusing the field would be new behaviour.
- A "Copy link" button in the in-app notice, which would need clipboard code.
- The InlineReauth "waiting" line.

**Out of scope**
- Logo-only buttons, One Tap and popups.
- Manual identity linking.
- Display-name prefill.
- Checkout entry points.
- Native-app button variants.
