#!/usr/bin/env python3
"""Build "Instrument Sans Dots": Instrument Sans with a dotted vowel for every plain one.

The owner asked for the brand's two dots (as in Sheltüh) over every vowel on the
site. That is done in the font, not the text: this script copies the latin
Instrument Sans woff2 that next/font/google serves and points the plain vowels
a e i o u A E I O U, in the font's character map, at the glyphs it already has
for ä ë ï ö ü Ä Ë Ï Ö Ü. The page text, accessible names, search, copy and
paste, stored data and emails stay plainly spelled; only the rendering changes.
Letters that already carry an accent keep their own glyph (ü stays ü).

The family is renamed "Instrument Sans Dots" (the OFL's "Modified Version";
Instrument Sans declares no Reserved Font Name, see
app/fonts/instrument-sans-dots/README.md) and is still under the SIL Open Font
License 1.1 (OFL.txt beside the output).

fontTools is a build-time tool only (`pip install fonttools brotli`); the app
loads the committed woff2 with next/font/local (app/fonts.ts). Re-run this only
when the source font changes:

    python3 -I scripts/build-dotted-font.py SOURCE.woff2 \
        app/fonts/instrument-sans-dots/InstrumentSansDots-latin.woff2

SOURCE.woff2 is the latin subset next/font/google downloads for
`Instrument_Sans({ subsets: ["latin"] })` (variable, wght 400-700); how to
fetch it is in the README.
"""

from __future__ import annotations

import hashlib
import sys

from fontTools.ttLib import TTFont

FAMILY = "Instrument Sans Dots"
POSTSCRIPT_FAMILY = "InstrumentSansDots"

# Each plain vowel takes the glyph of its diaeresis form (U+00E4 etc.).
VOWELS = {
    "a": "ä",
    "e": "ë",
    "i": "ï",
    "o": "ö",
    "u": "ü",
    "A": "Ä",
    "E": "Ë",
    "I": "Ï",
    "O": "Ö",
    "U": "Ü",
}

DESCRIPTION = (
    "Modified by Sheltuh from Instrument Sans: the plain vowels a e i o u A E I O U "
    "display their diaeresis forms. Renamed as an OFL Modified Version."
)
LICENSE_DESCRIPTION = (
    "This Font Software is licensed under the SIL Open Font License, Version 1.1. "
    "This license is available with a FAQ at: https://openfontlicense.org"
)


def remap_vowels(font: TTFont) -> None:
    best = font.getBestCmap()
    targets = {}
    for plain, dotted in VOWELS.items():
        glyph = best.get(ord(dotted))
        if glyph is None:
            raise SystemExit(f"source font has no glyph for {dotted!r}")
        targets[ord(plain)] = glyph
    changed = 0
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for code, glyph in targets.items():
            if code in table.cmap:
                table.cmap[code] = glyph
                changed += 1
    if changed == 0:
        raise SystemExit("no Unicode cmap subtable carried the vowels")


def rename(font: TTFont) -> None:
    name = font["name"]
    style = name.getDebugName(2) or "Regular"
    # Every record that names the family or the font: Windows (3) and Mac (1) platforms.
    replacements = {
        1: FAMILY,
        3: f"1.000;SHELTUH;{POSTSCRIPT_FAMILY}-{style}",
        4: f"{FAMILY} {style}",
        6: f"{POSTSCRIPT_FAMILY}-{style}",
        16: FAMILY,
        21: FAMILY,
        25: POSTSCRIPT_FAMILY,
    }
    for record in list(name.names):
        if record.nameID in replacements:
            name.setName(replacements[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    name.setName(DESCRIPTION, 10, 3, 1, 0x409)
    name.setName(LICENSE_DESCRIPTION, 13, 3, 1, 0x409)
    # Anything still carrying the old family name (named-instance PostScript names, etc.).
    for record in name.names:
        text = record.toUnicode()
        if record.nameID in (0, 13, 14, 10):
            continue
        if "InstrumentSans" in text and POSTSCRIPT_FAMILY not in text:
            name.setName(text.replace("InstrumentSans", POSTSCRIPT_FAMILY), record.nameID, record.platformID, record.platEncID, record.langID)
        elif "Instrument Sans" in text and FAMILY not in text:
            name.setName(text.replace("Instrument Sans", FAMILY), record.nameID, record.platformID, record.platEncID, record.langID)


def verify(path: str) -> None:
    font = TTFont(path)
    cmap = font.getBestCmap()
    for plain, dotted in VOWELS.items():
        if cmap[ord(plain)] != cmap[ord(dotted)]:
            raise SystemExit(f"{plain!r} is not mapped to the glyph of {dotted!r}")
        print(f"  {plain} -> {cmap[ord(plain)]}")
    for untouched in "bcdyBY0":
        if cmap[ord(untouched)] in {cmap[ord(d)] for d in VOWELS.values()}:
            raise SystemExit(f"{untouched!r} was remapped")
    family = font["name"].getDebugName(1)
    if family != FAMILY:
        raise SystemExit(f"family is {family!r}, expected {FAMILY!r}")
    axes = ", ".join(f"{a.axisTag} {a.minValue:g}-{a.maxValue:g}" for a in font["fvar"].axes) if "fvar" in font else "static"
    print(f"  family {family!r}, axes: {axes}, {len(cmap)} characters")


def main(argv: list[str]) -> None:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    source, output = argv[1], argv[2]
    with open(source, "rb") as handle:
        print(f"source {source}\n  sha256 {hashlib.sha256(handle.read()).hexdigest()}")
    # recalcTimestamp=False keeps head.modified as it was, so re-runs are byte-identical.
    font = TTFont(source, recalcTimestamp=False)
    source_family = font["name"].getDebugName(1)
    if source_family != "Instrument Sans":
        raise SystemExit(f"expected Instrument Sans, got {source_family!r}")
    remap_vowels(font)
    rename(font)
    font.flavor = "woff2"
    font.save(output)
    with open(output, "rb") as handle:
        print(f"wrote {output}\n  sha256 {hashlib.sha256(handle.read()).hexdigest()}")
    verify(output)


if __name__ == "__main__":
    main(sys.argv)
