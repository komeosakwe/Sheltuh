# Bootzy

`Bootzy-Regular.woff2` is the display face (`--face-display`, the `display-*`
type styles). It is the owner-supplied **Bootzy TM, Regular** (name table:
"Version 1.000;;BootzyTM;2024;FL800"), converted from the supplied OTF to WOFF2
with fontTools. Same character map (202 characters), outlines, metrics and
names as the OTF; only its digital-signature table (DSIG) is dropped, as
WOFF2 conversion does. It is not subset: the file is 130 KB, and
`app/fonts.ts` preloads it on every route (every page has a display
headline). Subsetting it is a follow-up if that weight matters.

## Licence

Bootzy is a commercial font, not open source. The web-embedding licence is
held by the owner; the licence text isn't in this repo yet. Add it here
(`LICENSE.txt` or the vendor's PDF) when the owner provides it. Don't reuse
the file outside this site.

## Coverage

202 characters: Basic Latin (no `*` or `~`), Latin-1 letters including `ü` and
`Ü`, and a few Latin Extended-A letters. It has no `·`, `…`, `→`, `×`,
macrons or no-break space. `app/fonts.ts` loads it with
`adjustFontFallback: false`, so any character it lacks falls through
`--face-display` to Instrument Sans rather than to a size-adjusted Arial.

## Rebuilding the WOFF2

A one-off dev step, only if the owner sends a new OTF:

    python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
    /tmp/ft/bin/python -I -c "from fontTools.ttLib import TTFont; f = TTFont('Bootzy.otf'); f.flavor = 'woff2'; f.save('app/fonts/bootzy/Bootzy-Regular.woff2')"
