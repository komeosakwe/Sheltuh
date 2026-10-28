# Email font: Nunito

The welcome emails (and the shared layout, `lib/server/email-layout.ts`) set
type in `'Nunito Sans','Nunito','Avenir Next','Segoe UI',Arial,sans-serif`.

- **Self-hosted, never Google Fonts.** `public/fonts/nunito/Nunito-VariableFont_wght.ttf`
  is served from the site's own origin. `page({ siteUrl })` adds an `@font-face`
  for `Nunito` (weights 400-600) to the email `<head>` only when `siteUrl` is
  https. Clients that ignore web fonts (Gmail, Outlook) use the fallback stack;
  Outlook for Windows is pinned to Segoe UI / Arial.
- **Source:** https://github.com/google/fonts/tree/main/ofl/nunito
  (`Nunito[wght].ttf`, fetched 27 Oct 2026), unmodified apart from the file name.
- **Licence:** SIL Open Font License 1.1, Copyright 2014 The Nunito Project
  Authors. The licence text is `public/fonts/nunito/OFL.txt`; keep it beside the font.
- **Format:** TTF. No woff2 converter was available without a new dependency;
  swap in a woff2 build (and the `format()` in the layout) if size matters.
- The owner approved self-hosting Nunito.
