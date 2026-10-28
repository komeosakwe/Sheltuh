# Sign-in artwork (Apple's: owner adds; Google's: committed)

"Continue with Apple" and "Continue with Google" (`components/auth/OAuthButtons.tsx`) show the vendors' **official** artwork from `public/auth/` (served at `/auth/<file>`), unmodified. Google's G is committed (below). Apple's logo files aren't: download them yourself, unmodified. **Never ship a stand-in.** `next build` fails if `NEXT_PUBLIC_AUTH_PROVIDERS` lists a provider whose files below are missing (`next.config.ts`, `assertOAuthLogos`). `next typegen` fails the same way (Next loads the config there as it does for a build); `next dev` doesn't check. The file names are set in `lib/auth/oauth-providers.ts` (`OAUTH_LOGO_FILES`).

This page lives in `docs/` rather than in `public/auth/` because everything in `public/` is served to anyone who asks for it.

The design spec is `docs/design/social-sign-in.md` (§4).

| File | What it is | Where it shows |
|---|---|---|
| `apple-logo-white.svg` | Apple's **logo-only** artwork, **white** | The black Apple button (White theme) |
| `apple-logo-black.svg` | Apple's **logo-only** artwork, **black** | The white Apple button (Dark theme) |
| `google-g.svg` | Google's standard multi-colour **"G"** (red, blue, yellow, green), one file for both themes | Inside the Google button, left of its title |

## Apple (needed when the flag lists `apple`)

1. Go to <https://developer.apple.com/design/resources/> and download the **Sign in with Apple** resources (Apple's button and logo artwork).
2. In the download, take the **logo-only** images (just the Apple logo, with its built-in padding, not a full button) in **SVG**, in **black** and in **white**.
3. Save them in `public/auth/` as `apple-logo-black.svg` and `apple-logo-white.svg`. Change nothing inside the files: no cropping, no recolouring, no removing or adding padding.

How they're used, following Apple's Human Interface Guidelines for a custom button: the logo file is shown at the button's full height (48px) with its own padding, beside the title "Continue with Apple". Logo and title are both white on the black button, or both black on the white one.

## Google (needed when the flag lists `google`; committed)

`google-g.svg` is Google's standard four-colour "G" mark (the four official paths, unmodified, on a 48×48 viewBox). The owner's Sign in with Google branding kit (27 Oct 2026, from <https://developers.google.com/identity/branding-guidelines>) has no separate G file: its "Show text=No" images are a G already inside a 40px circle with its own stroke (so it can't sit in our pill without a ring inside a ring), and its SVGs draw the G with a Figma `foreignObject` conic gradient that doesn't render reliably as an `<img>`. If you'd rather use a kit artwork, replace this file with a G-only SVG from Google and update the test in `tests/next-config.test.ts`.

The button is built in HTML and CSS to Google's guidelines (`.btn-oauth-google` in `app/globals.css`), with the title as real text:

| | Light (White theme) | Dark (Dark theme) |
|---|---|---|
| Fill (`--google-fill`) | `#FFFFFF` | `#131314` |
| Stroke, 1px (`--google-stroke`) | `#747775` | `#8E918F` |
| Title (`--google-text`) | `#1F1F1F` | `#E3E3E3` |

40px tall pill (radius 20px, as the guidelines specify; the brand test only bans 9999px), 12px left and right padding, a 20px G, 10px between the G and the title, "Continue with Google" in Roboto Medium 14px/20px (falling back to the site's sans stack). A `::before` takes the hit area to 48px. The G has `alt=""`; the button's accessible name is its visible text.

## Record where each came from

Note the source and download date for each file in the commit that adds them (Google's are recorded above). Don't commit the downloaded zip files.
