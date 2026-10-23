# Instrument Sans Dots

`InstrumentSansDots-latin.woff2` is a **Modified Version** of
[Instrument Sans](https://github.com/Instrument/instrument-sans)
(Copyright 2022 The Instrument Sans Project Authors), licensed under the
**SIL Open Font License 1.1**: see `OFL.txt` beside it. The modified font
is under the same licence.

## What changed

Only two things:

1. **Character map.** The plain vowels `a e i o u A E I O U` point at the
   glyphs the font already has for `ä ë ï ö ü Ä Ë Ï Ö Ü`. That's how the
   site puts the brand's two dots (as in Sheltüh) over every vowel (owner
   request, 23 Oct 2026). Letters that already carry an accent keep their
   own glyph, so `ü` is still `ü`. No outlines, metrics or kerning were
   edited.
2. **Names.** The family is renamed **Instrument Sans Dots** (PostScript
   `InstrumentSansDots-Regular`), and a description (name ID 10) and
   licence description (name ID 13) are added. The copyright notice
   (ID 0) and licence URL (ID 14) are kept.

Instrument Sans declares **no Reserved Font Name**: its `OFL.txt` has no
"with Reserved Font Name" clause, in either the upstream repo or Google
Fonts' copy. The rename keeps the modified font clearly apart from the
original even so.

## Why the font and not the text

The page text is unchanged. Accessible names, screen readers, search,
SEO, copy and paste, stored data and emails all see the plain spelling,
and only the rendering differs. `app/fonts.ts` loads it with
`next/font/local` as the CSS family `instrumentDots` (next/font names the
`--font-instrument-dots` variable after the export, so the `@font-face`
has to use the same name). `app/globals.css` uses this family first
in `--face-sans`, and so in `--face-display`. Form fields (`input`,
`textarea`, `select`, `[contenteditable]`) use `--face-sans-plain`, the
unmodified Instrument Sans, so what someone types looks the way they
typed it. IBM Plex Mono (codes, eyebrows, dates) is unchanged. Any
character outside this latin subset falls through to the original
Instrument Sans.

## Source

This is the latin subset that `next/font/google` serves for
`Instrument_Sans({ subsets: ["latin"] })`: Google Fonts `instrumentsans/v4`,
variable, `wght` 400–700, 208 characters. To fetch it, request this CSS
with next/font's user agent (`Mozilla/5.0 (Macintosh; Intel Mac OS X
10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0
Safari/537.36`):

    https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap

Then download the `/* latin */` block's woff2:

    https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1ZuWi3g.woff2

That file is byte-identical to the one in a `next build`'s
`.next/static/media/` (sha256 `6219bc4b…a2311`).

## Rebuilding

The build uses fontTools, a build-time tool only (nothing loads it at
runtime or in tests):

    python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
    /tmp/ft/bin/python -I scripts/build-dotted-font.py SOURCE.woff2 \
        app/fonts/instrument-sans-dots/InstrumentSansDots-latin.woff2

The script checks its own output: each vowel shares its dotted glyph,
other letters are untouched, and the family name is right. Re-runs are
byte-identical (sha256 `e78282b4…bf140` from the source above).
`tests/dotted-font.test.ts` reads the committed woff2 with a small parser
to check the same things.
