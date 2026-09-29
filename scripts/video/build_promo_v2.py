#!/usr/bin/env python3
"""Rebuild the Sheltuh promo (v2) from the Higgsfield web-hero composite.

The source (references/sheltuh-higgsfield-original.mp4) is a 1112x834 screen
capture of a landing page: static headline on the left, footage in a panel on
the right. This script lifts the clean footage out of that panel, re-cuts it
to the music's beat grid, grades it, and appends a type-only end card.

Everything the edit does lives in EDIT below, so shots regenerated in
Higgsfield can be conformed into the same slots later.

Requires: ffmpeg, numpy, opencv-python-headless, pillow.
Usage:    python3 scripts/video/build_promo_v2.py
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "references/sheltuh-higgsfield-original.mp4"
OUT = ROOT / "output/sheltuh-promo-v2.mp4"

FPS = 24
W, H = 1080, 1440
# Media panel inside the web composite, inset past its anti-aliased edges
# and the grey page border below it. 534x712 is exactly 3:4.
CROP_X, CROP_Y, CROP_W, CROP_H = 572, 61, 534, 712
K = W / CROP_W  # 2.0225 upscale, identical on both axes

# Music: a two-bar loop at ~135.3 BPM. Beat 0 of the edit is the first kick.
BEAT = 0.4436
AUDIO_START = 0.114
DURATION_BEATS = 18  # 8.0 s


def bf(beat: float) -> int:
    """Frame index nearest to a beat."""
    return round(beat * BEAT * FPS)


# The phone mockup sits 83 px left of centre and 30 px low in every app shot
# (same position in all of them), so one recentre keeps the bezel locked
# across the screen change.
PHONE_BOX = (15, 58, 353, 711)  # x0, y0, x1, y1 in crop coords, with margin
PHONE_SHIFT = (83, -30)

EDIT = [
    # Hook: daylight faces. Only 6 and 4 clean frames exist, so they are
    # step-printed at half speed (12 fps) under a slow push.
    dict(name="hook-curly", beats=(0, 1), frames=[67, 69, 71, 73, 76, 78],
         look="day", push=(1.0, 1.025), centre=(230, 210)),
    dict(name="hook-duo", beats=(1, 2), frames=[59, 61, 63, 65],
         look="day", push=(1.0, 1.025), centre=(270, 200)),
    # App: two static screens, recentred, one continuous push across both so
    # the cut between them reads as a screen change, not a new shot.
    dict(name="app-save", beats=(2, 5), frames=[330], look="phone", phone=True),
    dict(name="app-event", beats=(5, 10), frames=[262], look="phone", phone=True),
    # Payoff: night.
    dict(name="payoff-couple", beats=(10, 11), frames=[342, 344, 346, 349, 351],
         look="night", push=(1.0, 1.02), centre=(267, 220)),
    dict(name="payoff-mates", beats=(11, 12), frames=[141],
         look="club", push=(1.0, 1.03), centre=(267, 250)),
    dict(name="endcard", beats=(12, DURATION_BEATS), endcard=True),
]
APP_PUSH = (0.96, 1.01)  # phone scale from start of app-save to end of app-event

# Grades, in linear-ish 0-1 display RGB. Kept deliberately small.
LOOKS = {
    # overcast/golden daylight: open the crushed blacks, keep skin, warm top end
    "day": dict(wb=(1.01, 1.0, 0.975), gamma=1.0, sat=0.93, warm=0.018, contrast=0.12),
    # red-lit club: pull saturation so skin stops reading as pure red
    "night": dict(wb=(0.96, 1.02, 1.02), gamma=0.93, sat=0.80, warm=0.01, contrast=0.06),
    # blue/red club, underexposed: lift mids, trim saturation
    "club": dict(wb=(0.98, 1.0, 1.0), gamma=0.84, sat=0.82, warm=0.0, contrast=0.0),
    # product screens: neutral black, slight saturation trim on the red UI
    "phone": dict(wb=(1.0, 1.0, 1.0), gamma=1.0, sat=0.90, warm=0.0, contrast=0.0),
}
BLACK_LIFT = 0.022  # ~6/255: neutral, never crushed
SHOULDER = 0.80     # highlights roll off above this and top out near 0.94 (off-white)

BRAND_OFFWHITE = (245, 244, 240)  # --foreground  #f5f4f0
BRAND_BLACK = (11, 11, 14)        # --background  #0b0b0e


# --------------------------------------------------------------------------
# Source


def load_source_frames(path: Path) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        crop = f[CROP_Y:CROP_Y + CROP_H, CROP_X:CROP_X + CROP_W]
        frames.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0)
    if not frames:
        raise SystemExit(f"could not read {path}")
    return frames


def recentre_phone(img: np.ndarray, bg: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = PHONE_BOX
    dx, dy = PHONE_SHIFT
    # the source "black" is green-tinted; take the tint out of the whole shot
    # (a couple of code values, invisible on the bright UI)
    img = np.clip(img - (bg - bg.mean()), 0, 1)
    bg = np.full(3, bg.mean(), np.float32)
    canvas = np.empty_like(img)
    canvas[:] = bg
    patch = img[y0:y1, x0:x1]
    mask = np.zeros(patch.shape[:2], np.float32)
    mask[10:-10, 10:-10] = 1.0
    mask = cv2.GaussianBlur(mask, (0, 0), 5)[..., None]
    ty0, tx0 = y0 + dy, x0 + dx
    region = canvas[ty0:ty0 + patch.shape[0], tx0:tx0 + patch.shape[1]]
    region[:] = patch * mask + region * (1 - mask)
    return canvas


# --------------------------------------------------------------------------
# Grade, geometry, texture


def grade(img: np.ndarray, look: dict) -> np.ndarray:
    x = img * np.array(look["wb"], np.float32)
    x = np.clip(x, 0, 1) ** look["gamma"]
    y = x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    x = y[..., None] + (x - y[..., None]) * look["sat"]
    x = np.clip(x, 0, 1)
    # gentle S in the mids (smoothstep blend); ends stay put
    x = x + look["contrast"] * (x * x * (3 - 2 * x) - x)
    # soft shoulder: no hard clipping, whites land on off-white
    over = x > SHOULDER
    x[over] = SHOULDER + 0.16 * np.tanh((x[over] - SHOULDER) / 0.16)
    # warm only the highlights
    y = x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    w = np.clip((y - 0.55) / 0.45, 0, 1)[..., None]
    x = x + look["warm"] * w * np.array([1.0, 0.35, -1.0], np.float32)
    # neutral lifted black
    x = BLACK_LIFT + (1 - BLACK_LIFT) * x
    return np.clip(x, 0, 1)


def place(img: np.ndarray, scale: float, centre: tuple[float, float], bg) -> np.ndarray:
    """Upscale crop space to output, pushing in/out about `centre`."""
    cx, cy = centre
    m = np.array([[K * scale, 0, K * cx * (1 - scale)],
                  [0, K * scale, K * cy * (1 - scale)]], np.float32)
    border = tuple(float(v) for v in bg) if bg is not None else 0
    out = cv2.warpAffine(img, m, (W, H), flags=cv2.INTER_LANCZOS4,
                         borderMode=cv2.BORDER_CONSTANT if bg is not None else cv2.BORDER_REFLECT,
                         borderValue=border)
    # gentle unsharp to offset the 2x upscale; any stronger lifts macroblocks
    blur = cv2.GaussianBlur(out, (0, 0), 1.3)
    return np.clip(out + 0.3 * (out - blur), 0, 1)


def add_grain(img: np.ndarray, rng: np.random.Generator, strength: float) -> np.ndarray:
    n = rng.standard_normal((H // 2, W // 2)).astype(np.float32)
    n = cv2.resize(n, (W, H), interpolation=cv2.INTER_CUBIC)
    y = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    amp = strength * (0.45 + 2.2 * y * (1 - y))  # strongest in mids
    return np.clip(img + (n * amp)[..., None], 0, 1)


def step(frames: list[int], n: int) -> list[int]:
    """Spread n output frames evenly across the unique source frames."""
    return [frames[min(len(frames) - 1, k * len(frames) // n)] for k in range(n)]


# --------------------------------------------------------------------------
# End card


def fetch_font(cache: Path) -> Path:
    """Bebas Neue, the app's heading face (OFL), from the npm registry."""
    font = cache / "bebas-neue-latin-400-normal.woff"
    if font.exists():
        return font
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["npm", "pack", "@fontsource/bebas-neue@5.3.0", "--silent"],
                       cwd=tmp, check=True, capture_output=True)
        tgz = next(Path(tmp).glob("*.tgz"))
        with tarfile.open(tgz) as t:
            member = t.getmember("package/files/bebas-neue-latin-400-normal.woff")
            with t.extractfile(member) as src, open(font, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return font


def draw_tracked(draw, xy, text, font, tracking, fill):
    x, y = xy
    for i, ch in enumerate(text):
        draw.text((x, y), ch, font=font, fill=fill)
        adv = font.getlength(ch)
        if i + 1 < len(text):
            pair = text[i:i + 2]
            adv += font.getlength(pair) - font.getlength(ch) - font.getlength(text[i + 1])
        x += adv + tracking


def tracked_width(text, font, tracking):
    return font.getlength(text) + tracking * (len(text) - 1)


def render_endcard_layers(font_path: Path):
    """Returns (base, tagline_alpha, tagline_colour) at output size, SS 2x."""
    ss = 2
    w, h = W * ss, H * ss
    word_font = ImageFont.truetype(str(font_path), 300 * ss)
    tag_font = ImageFont.truetype(str(font_path), 52 * ss)
    word, tag = "SHELTUH", "FIND YOUR SCENE."
    word_track, tag_track = 6 * ss, 12 * ss

    wb = word_font.getbbox(word)  # (x0, y0, x1, y1) of ink
    cap_h = wb[3] - wb[1]
    tb = tag_font.getbbox(tag)
    tag_cap = tb[3] - tb[1]
    gap = int(cap_h * 0.34)
    block = cap_h + gap + tag_cap
    top = int(h * 0.47 - block / 2)  # optical centre, a touch above middle

    base = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(base)
    ww = tracked_width(word, word_font, word_track)
    draw_tracked(d, ((w - ww) / 2, top - wb[1]), word, word_font, word_track, 255)

    tagl = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(tagl)
    tw = tracked_width(tag, tag_font, tag_track)
    draw_tracked(d, ((w - tw) / 2, top + cap_h + gap - tb[1]), tag, tag_font, tag_track, 255)

    down = lambda im: cv2.resize(np.asarray(im, np.float32) / 255.0, (W, H),
                                 interpolation=cv2.INTER_AREA)
    return down(base), down(tagl)


def endcard_frame(word_a, tag_a, t_since_tag: float) -> np.ndarray:
    bg = np.array(BRAND_OFFWHITE, np.float32) / 255.0
    ink = np.array(BRAND_BLACK, np.float32) / 255.0
    # tagline: 6-frame fade with a 6 px rise, ease-out
    p = np.clip(t_since_tag / (6 / FPS), 0, 1)
    ease = 1 - (1 - p) ** 3
    shift = int(round((1 - ease) * 6))
    tag = np.roll(tag_a, shift, axis=0) * ease
    alpha = np.clip(word_a + tag, 0, 1)[..., None]
    img = np.empty((H, W, 3), np.float32)
    img[:] = bg
    return img * (1 - alpha) + ink * alpha


# --------------------------------------------------------------------------
# Audio


def build_audio(src: Path, dst: Path, tmp: Path, endcard_t: float, total: float):
    sr = 48000
    raw = tmp / "music.f32"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{AUDIO_START}", "-t", f"{total}",
                    "-i", str(src), "-vn", "-af", "aresample=48000:resampler=soxr",
                    "-f", "f32le", "-ac", "2", str(raw)], check=True)
    x = np.fromfile(raw, np.float32).reshape(-1, 2).astype(np.float64)
    n = len(x)
    t = np.arange(n) / sr

    # "Leaving the room": at the end card the club lowpasses away over one
    # beat and settles muffled, then fades out under the type. Untouched
    # before the cut; the filter state starts from the signal so it doesn't
    # click (and the cut lands on a kick, which masks what's left).
    start = int(endcard_t * sr)
    frac = np.clip((t[start:] - endcard_t) / BEAT, 0, 1)
    fc = 18000.0 * (900.0 / 18000.0) ** frac
    q = 0.707
    coeffs = []
    for f in fc:
        w0 = 2 * math.pi * f / sr
        alpha = math.sin(w0) / (2 * q)
        cw = math.cos(w0)
        a0 = 1 + alpha
        coeffs.append(((1 - cw) / 2 / a0, (1 - cw) / a0, -2 * cw / a0, (1 - alpha) / a0))
    y = x.copy()
    for ch in range(2):
        xs = x[:, ch].tolist()
        x1, x2 = xs[start - 1], xs[start - 2]
        y1, y2 = x1, x2
        for j, (b0, b1, a1, a2) in enumerate(coeffs):
            xi = xs[start + j]
            yi = b0 * xi + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, xi, y1, yi
            y[start + j, ch] = yi

    gain = np.ones(n)
    fade_start, fade_end = endcard_t + 2 * BEAT, total - 0.08
    f = (t >= fade_start) & (t < fade_end)
    gain[f] = 0.5 * (1 + np.cos(math.pi * (t[f] - fade_start) / (fade_end - fade_start)))
    gain[t >= fade_end] = 0.0
    gain[: int(0.006 * sr)] = np.linspace(0, 1, int(0.006 * sr))  # declick
    y *= gain[:, None]

    pre = tmp / "music_pre.wav"
    y.astype(np.float32).tofile(tmp / "music_pre.f32")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "2",
                    "-i", str(tmp / "music_pre.f32"), "-af", "highpass=f=25:poles=2",
                    str(pre)], check=True)
    # two-pass loudness: -14 LUFS integrated, -1.5 dBTP
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(pre), "-af",
                            "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    ln = ("loudnorm=I=-14:TP=-1.5:LRA=11:linear=true:"
          f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
          f"offset={m['target_offset']}")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(pre), "-af",
                    ln + ",aresample=48000", "-c:a", "pcm_s24le", str(dst)], check=True)


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=SRC)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--font", type=Path, default=None, help="Bebas Neue .ttf/.woff")
    ap.add_argument("--grain", type=float, default=0.011)
    ap.add_argument("--crf", type=int, default=16)
    args = ap.parse_args()

    font = args.font or fetch_font(Path(tempfile.gettempdir()) / "sheltuh-fonts")
    src = load_source_frames(args.src)
    total_frames = bf(DURATION_BEATS)
    rng = np.random.default_rng(7)

    # background colour behind the phone, measured off the source
    bg_samples = np.concatenate([src[262][100:600, 380:520].reshape(-1, 3),
                                 src[262][0:50, 100:500].reshape(-1, 3)])
    phone_bg = np.median(bg_samples, axis=0)
    phone_bg_graded = grade(np.full((1, 1, 3), phone_bg.mean(), np.float32), LOOKS["phone"])[0, 0]

    app = [s for s in EDIT if s.get("phone")]
    app_start, app_end = bf(app[0]["beats"][0]), bf(app[-1]["beats"][1])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpd:
        tmp = Path(tmpd)
        silent = tmp / "picture.mp4"
        enc = subprocess.Popen([
            "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int",
            "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf), "-tune", "grain",
            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
            "-color_trc", "bt709", "-color_range", "tv", "-g", str(FPS * 2),
            "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)

        endcard_layers = None
        written = 0
        for shot in EDIT:
            a, b = bf(shot["beats"][0]), bf(shot["beats"][1])
            n = b - a
            if shot.get("endcard"):
                if endcard_layers is None:
                    endcard_layers = render_endcard_layers(font)
                word_a, tag_a = endcard_layers
                tag_at = bf(shot["beats"][0] + 1)
                for k in range(n):
                    img = endcard_frame(word_a, tag_a, (a + k - tag_at) / FPS)
                    img = add_grain(img, rng, args.grain * 0.55)
                    enc.stdin.write((img * 255 + 0.5).astype(np.uint8).tobytes())
                written += n
                continue

            look = LOOKS[shot["look"]]
            seq = step(shot["frames"], n)
            cache = {}
            for k, fi in enumerate(seq):
                if fi not in cache:
                    img = src[fi]
                    if shot.get("phone"):
                        img = recentre_phone(img, phone_bg)
                    cache[fi] = grade(img, look)
                g = cache[fi]
                if shot.get("phone"):
                    p = (a + k - app_start) / max(1, app_end - app_start - 1)
                    scale = APP_PUSH[0] + (APP_PUSH[1] - APP_PUSH[0]) * p
                    out = place(g, scale, (CROP_W / 2, CROP_H / 2), phone_bg_graded)
                else:
                    p = k / max(1, n - 1)
                    scale = shot["push"][0] + (shot["push"][1] - shot["push"][0]) * p
                    out = place(g, scale, shot["centre"], None)
                out = add_grain(out, rng, args.grain)
                enc.stdin.write((out * 255 + 0.5).astype(np.uint8).tobytes())
            written += n

        enc.stdin.close()
        if enc.wait() != 0:
            raise SystemExit("video encode failed")
        assert written == total_frames, (written, total_frames)

        audio = tmp / "music.wav"
        build_audio(args.src, audio, tmp, endcard_t=bf(12) / FPS, total=total_frames / FPS)

        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-i", str(audio),
                        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                        "-b:a", "256k", "-ar", "48000", "-t", f"{total_frames / FPS}",
                        "-movflags", "+faststart", str(args.out)], check=True)
    print(f"wrote {args.out} ({total_frames} frames, {total_frames / FPS:.2f}s)")


if __name__ == "__main__":
    main()
