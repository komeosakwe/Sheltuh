# Sign-in artwork (Apple's: owner adds; Google's: committed)

"Continue with Apple" and "Sign in with Google" (`components/auth/OAuthButtons.tsx`) show the vendors' **official** artwork from `public/auth/` (served at `/auth/<file>`), unmodified. Google's button images are committed (below). Apple's logo files aren't: download them yourself, unmodified. **Never ship a stand-in.** `next build` fails if `NEXT_PUBLIC_AUTH_PROVIDERS` lists a provider whose files below are missing (`next.config.ts`, `assertOAuthLogos`). `next typegen` fails the same way (Next loads the config there as it does for a build); `next dev` doesn't check. The file names are set in `lib/auth/oauth-providers.ts` (`OAUTH_LOGO_FILES`).

This page lives in `docs/` rather than in `public/auth/` because everything in `public/` is served to anyone who asks for it.

The design spec is `docs/design/social-sign-in.md` (§4).

| File | What it is | Where it shows |
|---|---|---|
| `apple-logo-white.svg` | Apple's **logo-only** artwork, **white** | The black Apple button (White theme) |
| `apple-logo-black.svg` | Apple's **logo-only** artwork, **black** | The white Apple button (Dark theme) |
| `google-signin-light@2x.png`, `google-signin-light@4x.png` | Google's whole **Light** "Sign in with Google" button (pill, with text) | The Google button, White theme |
| `google-signin-dark@2x.png`, `google-signin-dark@4x.png` | Google's whole **Dark** "Sign in with Google" button (pill, with text) | The Google button, Dark theme |

## Apple (needed when the flag lists `apple`)

1. Go to <https://developer.apple.com/design/resources/> and download the **Sign in with Apple** resources (Apple's button and logo artwork).
2. In the download, take the **logo-only** images (just the Apple logo, with its built-in padding, not a full button) in **SVG**, in **black** and in **white**.
3. Save them in `public/auth/` as `apple-logo-black.svg` and `apple-logo-white.svg`. Change nothing inside the files: no cropping, no recolouring, no removing or adding padding.

How they're used, following Apple's Human Interface Guidelines for a custom button: the logo file is shown at the button's full height (48px) with its own padding, beside the title "Continue with Apple". Logo and title are both white on the black button, or both black on the white one.

## Google (needed when the flag lists `google`; committed)

Source: the **Sign in with Google branding kit provided by the owner on 27 Oct 2026** (Google's current kit, from <https://developers.google.com/identity/branding-guidelines>). The kit has no standalone "G": only whole button images, so the button *is* Google's image. From its `Android + Web` folder, the **Pill**, **Show text=Yes** images, copied byte for byte (no cropping, recolouring, re-encoding or re-rendering) and renamed:

| File in `public/auth/` | Kit file | Size | SHA-256 |
|---|---|---|---|
| `google-signin-light@2x.png` | `PNG @2x/Light/Theme=Light, Show text=Yes, Shape=Pill, Platform=Android+Web@2x.png` | 360×80 | `86c7955ee72f3635dc4e1415ac6e10035ca0bb1319245c8e1b441ce1cb5f6981` |
| `google-signin-light@4x.png` | `PNG @4x/Light/Theme=Light, Show text=Yes, Shape=Pill, Platform=Android+Web@4x.png` | 720×160 | `2f30a746fd0acc72417c460139f3a2ae9f93d3e31bb6f44181719556ec54a2d5` |
| `google-signin-dark@2x.png` | `PNG @2x/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web@2x.png` | 360×80 | `e0289ad5a31e65af63e385a89457cf3b2405d3a6dda2df6119778b9afdb74bae` |
| `google-signin-dark@4x.png` | `PNG @4x/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web@4x.png` | 720×160 | `1aa891e26e1d9ff7ad15e7e56874f3e15daa3e85c74c674fa763badc37417b55` |

`tests/next-config.test.ts` checks each file's size and SHA-256, so a changed file fails the tests.

How they're used: the image is the whole button, at its native CSS size of **180×40** (`srcset` 2x/4x), centred under the Apple button. Light on the White theme, Dark on the Dark theme (`data-theme="dark"`, the site's theme switch). The `<button>` around it has no fill, border or padding of its own and nothing is drawn over the image (no hover wash); the focus ring is the site's usual one around it, and an invisible extension takes the hit area to 48px tall without stretching the image. The image has `alt=""`; the button's name is the image's words, **"Sign in with Google"**, as screen-reader text.

Why not the kit's SVGs: they draw the "G" with a Figma `foreignObject` conic gradient, which doesn't render reliably as an `<img>`.

To replace them with a newer kit: copy the same four images unmodified under the same names, then update the sizes and SHA-256s here and in `tests/next-config.test.ts`.

## Record where each came from

Note the source and download date for each file in the commit that adds them (Google's are recorded above). Don't commit the downloaded zip files.
