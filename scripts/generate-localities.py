#!/usr/bin/env python3
"""Generate lib/localities.ts: one centre point per Australian suburb/locality.

Source: Australian Bureau of Statistics, "Australian Statistical Geography
Standard (ASGS) Edition 4 (2026) - Non ABS Structures", Suburbs and
Localities (SAL) layer, GDA2020 GeoPackage, CC BY 4.0, on data.gov.au:

    https://data.gov.au/data/dataset/9c172870-f5e5-4d5b-82bf-51488ed6baf3
    (resource asgs_ed4_non_abs_structures_gda2020_gpkg.zip)

Re-run when the ABS publishes a new edition (standard library only; no
shapely, GDAL or numpy):

    python3 -I scripts/generate-localities.py \
        PATH/TO/ASGS_Ed4_Non_ABS_Structures_GDA2020.gpkg lib/localities.ts

The GeoPackage is untrusted input: it is opened read-only and its rows are
only parsed as numbers and short names, which are checked before they're
written out. Keep the download outside the repo (it's about 500 MB).

For each SAL it keeps:
  * the name without the ABS bracket ("Richmond (Vic)" -> "Richmond"), and
    the bracket's place qualifier when there is one ("Richmond (Mackay -
    Qld)" -> "Mackay"), which the ABS adds only to tell apart same-named
    localities within one state;
  * the state or territory;
  * a representative point: the area-weighted centroid of its polygons, or,
    when that falls outside them (a crescent, a ring of islands), the
    middle of the widest stretch across the largest polygon at that
    latitude; rounded to 3 decimals (about 100 m);
  * its reach: how far, in whole km rounded up, its boundary goes from that
    point (the furthest vertex), so lib/location.ts can tell "in Australia,
    nearest is X" from "off the coast or overseas".

It drops the rows that aren't places: "No usual address", "Migratory -
Offshore - Shipping" and "Outside Australia" (they have no geometry).
"""

from __future__ import annotations

import math
import re
import sqlite3
import struct
import sys
from datetime import date

LAYER = "SAL_2026_AUST_GDA2020"
EDITION = "ASGS Edition 4 (2026)"

# ABS state codes -> the abbreviations used in Australian addresses.
STATES = {
    "1": "NSW",
    "2": "VIC",
    "3": "QLD",
    "4": "SA",
    "5": "WA",
    "6": "TAS",
    "7": "NT",
    "8": "ACT",
    "9": "OT",  # Other Territories: Jervis Bay, Christmas Island, Cocos (Keeling) Islands, Norfolk Island
}
# The bracket's state spelling, as the ABS writes it ("(Vic)", "(Mackay - Qld)").
ABS_STATE = {"NSW": "NSW", "VIC": "Vic", "QLD": "Qld", "SA": "SA", "WA": "WA", "TAS": "Tas", "NT": "NT", "ACT": "ACT", "OT": "OT"}
NOT_PLACES = re.compile(r"^(No usual address|Migratory - Offshore - Shipping|Outside Australia)\b")
NAME_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 '\-.]*$")
EARTH_KM = 6371.0


def gpkg_wkb(blob: bytes) -> memoryview:
    """The WKB inside a GeoPackage geometry blob (GeoPackage spec 2.1.3)."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    flags = blob[3]
    if flags & 0b10000:
        raise ValueError("empty geometry")
    envelope = (flags >> 1) & 0b111
    size = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
    return memoryview(blob)[8 + size :]


def read_polygons(wkb: memoryview) -> list[list[list[tuple[float, float]]]]:
    """(Multi)polygon WKB -> polygons -> rings -> (x=lng, y=lat) points. 2D only."""
    polygons: list[list[list[tuple[float, float]]]] = []

    def geometry(offset: int) -> int:
        order = "<" if wkb[offset] == 1 else ">"
        (kind,) = struct.unpack_from(order + "I", wkb, offset + 1)
        offset += 5
        if kind == 3:  # Polygon
            (count,) = struct.unpack_from(order + "I", wkb, offset)
            offset += 4
            rings = []
            for _ in range(count):
                (points,) = struct.unpack_from(order + "I", wkb, offset)
                offset += 4
                flat = struct.unpack_from(f"{order}{points * 2}d", wkb, offset)
                offset += points * 16
                rings.append(list(zip(flat[0::2], flat[1::2])))
            polygons.append(rings)
            return offset
        if kind == 6:  # MultiPolygon
            (count,) = struct.unpack_from(order + "I", wkb, offset)
            offset += 4
            for _ in range(count):
                offset = geometry(offset)
            return offset
        raise ValueError(f"unexpected WKB geometry type {kind}")

    geometry(0)
    return polygons


def ring_area_centroid(ring: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Unsigned area and centroid of one ring (shoelace, relative to its first point)."""
    x0, y0 = ring[0]
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        x1 -= x0
        y1 -= y0
        x2 -= x0
        y2 -= y0
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if a == 0:
        return 0.0, x0, y0
    return abs(a) / 2, x0 + cx / (3 * a), y0 + cy / (3 * a)


def polygon_area_centroid(rings: list[list[tuple[float, float]]]) -> tuple[float, float, float]:
    """Area and centroid of a polygon: the outer ring less its holes."""
    total = sx = sy = 0.0
    for i, ring in enumerate(rings):
        area, x, y = ring_area_centroid(ring)
        sign = 1 if i == 0 else -1
        total += sign * area
        sx += sign * area * x
        sy += sign * area * y
    if total <= 0:
        return 0.0, rings[0][0][0], rings[0][0][1]
    return total, sx / total, sy / total


def inside(rings: list[list[tuple[float, float]]], x: float, y: float) -> bool:
    """Even-odd point in polygon (holes included)."""
    hit = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
    return hit


def widest_stretch(rings: list[list[tuple[float, float]]], y: float) -> tuple[float, float] | None:
    """Middle of the widest inside stretch of the polygon along latitude y."""
    xs: list[float] = []
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    best = None
    for left, right in zip(xs[0::2], xs[1::2]):
        if best is None or right - left > best[1] - best[0]:
            best = (left, right)
    return ((best[0] + best[1]) / 2, y) if best else None


def representative_point(polygons: list[list[list[tuple[float, float]]]]) -> tuple[float, float]:
    parts = [(polygon_area_centroid(rings), rings) for rings in polygons]
    total = sum(area for (area, _, _), _ in parts)
    x = sum(area * cx for (area, cx, _), _ in parts) / total
    y = sum(area * cy for (area, _, cy), _ in parts) / total
    if any(inside(rings, x, y) for _, rings in parts):
        return x, y
    (area, cx, cy), largest = max(parts, key=lambda part: part[0][0])
    if inside(largest, cx, cy):
        return cx, cy
    ys = [p[1] for p in largest[0]]
    low, high = min(ys), max(ys)
    for t in (None, 0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875):
        at = cy if t is None else low + (high - low) * t
        point = widest_stretch(largest, at)
        if point and inside(largest, *point):
            return point
    raise ValueError("no point inside the polygon")


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance, as lib/location.ts distanceKm computes it."""
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lng = (lng2 - lng1) * rad
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def split_name(raw: str, state: str) -> tuple[str, str]:
    """ "Richmond (Mackay - Qld)" -> ("Richmond", "Mackay"); "Richmond (Vic)" -> ("Richmond", "")."""
    match = re.fullmatch(r"(.+?) \(([^()]+)\)", raw)
    if not match:
        return raw, ""
    name, bracket = match.groups()
    parts = bracket.split(" - ")
    if parts[-1] != ABS_STATE[state] or len(parts) > 2:
        raise ValueError(f"unexpected bracket in {raw!r}")
    return name, parts[0] if len(parts) == 2 else ""


def main(gpkg: str, out: str) -> None:
    con = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    (changed,) = con.execute("SELECT last_change FROM gpkg_contents WHERE table_name = ?", (LAYER,)).fetchone()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", str(changed)):
        raise ValueError(f"unexpected last_change {changed!r}")
    rows: list[tuple[str, str, str, int, int, int]] = []
    skipped = 0
    query = f'SELECT SAL_NAME_2026, STATE_CODE_2026, GEOM FROM "{LAYER}" ORDER BY SAL_CODE_2026'
    for raw_name, state_code, blob in con.execute(query):
        if not isinstance(raw_name, str) or NOT_PLACES.match(raw_name):
            skipped += 1
            continue
        state = STATES[state_code]
        name, qualifier = split_name(raw_name, state)
        for text in (name, qualifier):
            if text and not (NAME_OK.match(text) and len(text) <= 50):
                raise ValueError(f"unexpected name {raw_name!r}")
        polygons = read_polygons(gpkg_wkb(blob))
        x, y = representative_point(polygons)
        lat, lng = round(y, 3), round(x, 3)
        if not (-56 < lat < -8 and 95 < lng < 170):
            raise ValueError(f"{raw_name!r} at {lat},{lng} is not in Australia")
        reach = max(distance_km(lat, lng, py, px) for rings in polygons for px, py in rings[0])
        rows.append((state, name, qualifier, round(lat * 1000), round(lng * 1000), max(1, math.ceil(reach))))
        if len(rows) % 1000 == 0:
            print(f"{len(rows)} localities...", file=sys.stderr)

    rows.sort(key=lambda r: (list(STATES.values()).index(r[0]), r[1].lower(), r[1], r[2]))
    with open(out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(render(rows, str(changed)[:10]))
    print(f"wrote {len(rows)} localities to {out} (skipped {skipped} non-place rows)", file=sys.stderr)


B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def base36(value: int, width: int) -> str:
    if value < 0:
        raise ValueError(f"{value} is below the offset")
    digits = ""
    n = value
    while n:
        n, d = divmod(n, 36)
        digits = B36[d] + digits
    digits = digits.rjust(width, "0")
    if len(digits) != width:
        raise ValueError(f"{value} doesn't fit in {width} base-36 digits")
    return digits


# Thousandths of a degree from these offsets: latitude in 3 base-36 digits (-8.000, north of the
# Torres Strait islands, to -54.655, south of Macquarie Island), longitude in 4 (from 95.000, west
# of the Cocos Islands; 4 digits reach far past Norfolk Island).
LAT_OFFSET = 8_000
LNG_OFFSET = 95_000


# Reach, in km, in one base-36 digit: the digit is the index of the first step at or above it.
REACH_KM = list(range(1, 21)) + [25, 30, 35, 40, 50, 60, 70, 80, 100, 125, 150, 200, 300, 450, 650, 1300]
assert len(REACH_KM) == 36


def reach_digit(km: int) -> str:
    for index, step in enumerate(REACH_KM):
        if km <= step:
            return B36[index]
    raise ValueError(f"reach {km} km is past the last step")


def encode_row(name: str, qualifier: str, lat: int, lng: int, reach: int) -> str:
    """Name[~Qualifier], then 3 base-36 digits of latitude, 4 of longitude and 1 of reach."""
    label = f"{name}~{qualifier}" if qualifier else name
    return label + base36(-lat - LAT_OFFSET, 3) + base36(lng - LNG_OFFSET, 4) + reach_digit(reach)


def render(rows: list[tuple[str, str, str, int, int, int]], changed: str) -> str:
    by_state: dict[str, list[str]] = {state: [] for state in STATES.values()}
    for state, name, qualifier, lat, lng, reach in rows:
        by_state[state].append(encode_row(name, qualifier, lat, lng, reach))
    body = "\n".join(f'  {state}: "{"|".join(items)}",' for state, items in by_state.items())
    counts = ", ".join(f"{state} {len(items)}" for state, items in by_state.items())
    header = HEADER.format(
        rows=len(rows), counts=counts, changed=changed, today=date.today().isoformat(), edition=EDITION
    )
    steps = ", ".join(str(step) for step in REACH_KM)
    return header + f"export const LOCALITY_REACH_KM: readonly number[] = [{steps}];\n\n" + DATA_START + body + "\n};\n"


HEADER = """\
/**
 * Every Australian suburb and locality, one centre point each, for "near
 * you" search (lib/location.ts, components/search/LocationPicker.tsx).
 * Loaded only where a suburb is looked up: keep it out of eagerly imported
 * client modules (see lib/location.ts).
 *
 * Source: Australian Bureau of Statistics, {edition} - Non ABS
 * Structures, Suburbs and Localities (SAL), GDA2020, layer dated {changed},
 * from data.gov.au (dataset 9c172870-f5e5-4d5b-82bf-51488ed6baf3).
 * Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/);
 * credited on /about.
 * Generated {today} by scripts/generate-localities.py from the GeoPackage
 * (how to re-run it is in that script). Do not edit by hand.
 *
 * Rows: {rows}
 * ({counts}).
 * The ABS's non-place rows (No usual address, Migratory - Offshore -
 * Shipping, Outside Australia) are left out.
 *
 * Each point is the locality's area-weighted centroid, or a point inside it
 * when the centroid falls outside (odd shapes), rounded to 3 decimals
 * (about 100 m). "Reach" is how far its boundary goes from that point.
 *
 * Encoding, per state, rows joined by "|": the ABS name without its
 * bracket, then "~" and the bracket's place qualifier if it has one
 * ("Richmond~Mackay" for "Richmond (Mackay - Qld)"), then 8 base-36 digits:
 * 3 for latitude (-(8 + n / 1000)), 4 for longitude (95 + n / 1000) and 1
 * for reach (LOCALITY_REACH_KM[n], rounded up to that step).
 */
"""

DATA_START = """\
export const LOCALITY_DATA: Readonly<Record<"NSW" | "VIC" | "QLD" | "SA" | "WA" | "TAS" | "NT" | "ACT" | "OT", string>> = {
"""


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python3 -I scripts/generate-localities.py SAL.gpkg lib/localities.ts")
    main(sys.argv[1], sys.argv[2])
