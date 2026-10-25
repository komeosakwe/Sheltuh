# Sign-in logos (owner adds these)

"Continue with Apple" and "Continue with Google" (`components/auth/OAuthButtons.tsx`) show the vendors' **official** logo files from this folder. They're not committed: download them yourself, unmodified. **Never ship a stand-in.** `next build` fails if `NEXT_PUBLIC_AUTH_PROVIDERS` lists a provider whose files below are missing (`next.config.ts`, `assertOAuthLogos`). The file names are set in `lib/auth/oauth-providers.ts` (`OAUTH_LOGO_FILES`).

The design spec is `docs/design/social-sign-in.md` (§4).

| File | What it is | Where it shows |
|---|---|---|
| `apple-logo-white.svg` | Apple's **logo-only** artwork, **white** | The black Apple button (White theme) |
| `apple-logo-black.svg` | Apple's **logo-only** artwork, **black** | The white Apple button (Dark theme) |
| `google-g.svg` | Google's standard multicolour **"G"** | The Google button, both themes |

## Apple (needed when the flag lists `apple`)

1. Go to <https://developer.apple.com/design/resources/> and download the **Sign in with Apple** resources (Apple's button and logo artwork).
2. In the download, take the **logo-only** images (just the Apple logo, with its built-in padding, not a full button) in **SVG**, in **black** and in **white**.
3. Save them here as `apple-logo-black.svg` and `apple-logo-white.svg`. Change nothing inside the files: no cropping, no recolouring, no removing or adding padding.

How they're used, following Apple's Human Interface Guidelines for a custom button: the logo file is shown at the button's full height (48px) with its own padding, beside the title "Continue with Apple". Logo and title are both white on the black button, or both black on the white one.

## Google (needed when the flag lists `google`)

1. Go to <https://developers.google.com/identity/branding-guidelines> and download the Sign in with Google branding kit linked there.
2. Take the standard multicolour **"G"** logo in **SVG**. It's the only "G" allowed: never a monochrome or recoloured one.
3. Save it here as `google-g.svg`, unmodified.

It's shown at 24×24px, before the title "Continue with Google", on Google's Dark button (White theme) and Light button (Dark theme).

**Check against Google's kit before turning Google on.** Google's guidelines couldn't be read when this was built, so the button's colours, font size, "G" size, padding and corner radius come from memory (each is marked "unverified" in the spec and in `app/globals.css`). If the kit says the Dark button's "G" needs a different file or a backing, a second file name has to be added to `OAUTH_LOGO_FILES` first.

## Record where each came from

Note the source URL and download date for each file in the commit that adds them. Don't commit the downloaded zip files.
