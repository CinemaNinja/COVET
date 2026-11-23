#!/usr/bin/env python3
"""Build the cutouts for the Canvas view.

Usage (from the repo root, on a Mac):
    .venv/bin/python tools/canvas_build.py

Reads every piece in catalog.js and covet-collection.js, lifts the subject
out of its first photo, and writes:

    images/canvas/atlas.webp      every piece as a tiny cutout, one file
    images/canvas/<path>.webp     a larger cutout, loaded when zoomed in
    canvas-data.js                where each piece sits in the atlas

Run it again whenever pieces are added, removed, or re-photographed. A piece
that is missing from canvas-data.js still shows on the canvas, as its plain
photo.

The lifting is done by the macOS Vision framework (tools/lift.swift), so this
needs a Mac with the Xcode command line tools. A photo with no clear subject,
or one the subject fills, is kept whole with soft corners instead.
"""
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parent.parent
SOURCES = [REPO / "catalog.js", REPO / "covet-collection.js"]
OUT_DIR = REPO / "images" / "canvas"
MANIFEST = REPO / "canvas-data.js"

TINY = 144      # longest side of a piece in the atlas
GUTTER = 4      # clear pixels around each atlas cell, so neighbours never bleed
LARGE = 720     # longest side of the zoomed-in cutout
WHOLE = 0.90    # subject covers this much of the frame: keep the photo whole
SPECK = 0.004   # subject smaller than this share of the frame: not a real find


def piece_photos() -> list:
    """First photo of every piece, in file order, without repeats."""
    seen, photos = set(), []
    for source in SOURCES:
        for path in re.findall(r'"image":\s*"([^"]+)"', source.read_text()):
            path = path.split("?")[0]
            if path not in seen:
                seen.add(path)
                photos.append(path)
    return photos


def lift_all(photos: list, work: Path) -> dict:
    """Run the Vision lift over every photo. Returns {photo: lifted png path}."""
    binary = work / "lift-subject"
    built = subprocess.run(
        ["swiftc", "-O", str(REPO / "tools" / "lift.swift"), "-o", str(binary)],
        capture_output=True, text=True,
    )
    if built.returncode:
        sys.exit("could not build tools/lift.swift:\n" + built.stderr)
    targets = {photo: work / f"{n:04d}.png" for n, photo in enumerate(photos)}
    pairs = []
    for photo, target in targets.items():
        pairs += [str(REPO / photo), str(target)]
    done = subprocess.run([str(binary)] + pairs, capture_output=True, text=True)
    for line in done.stdout.splitlines():
        if not line.startswith("OK "):
            print("  " + line.replace(str(REPO) + "/", ""))
    return {photo: target for photo, target in targets.items() if target.exists()}


def soft_plate(photo: Path) -> np.ndarray:
    """The whole photo with rounded, feathered corners, as float RGBA."""
    im = cv2.imread(str(photo), cv2.IMREAD_COLOR)
    if im is None:
        raise RuntimeError(f"unreadable photo {photo}")
    h, w = im.shape[:2]
    scale = min(1.0, 1100 / max(h, w))
    if scale < 1:
        im = cv2.resize(im, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        h, w = im.shape[:2]
    radius = max(4, round(min(h, w) * 0.07))
    feather = max(1.0, min(h, w) * 0.006)
    mask = np.zeros((h, w), np.float32)
    inset = int(feather * 2)
    cv2.rectangle(mask, (inset + radius, inset), (w - inset - radius - 1, h - inset - 1), 1.0, -1)
    cv2.rectangle(mask, (inset, inset + radius), (w - inset - 1, h - inset - radius - 1), 1.0, -1)
    for cx in (inset + radius, w - inset - radius - 1):
        for cy in (inset + radius, h - inset - radius - 1):
            cv2.circle(mask, (cx, cy), radius, 1.0, -1, cv2.LINE_AA)
    mask = cv2.GaussianBlur(mask, (0, 0), feather)
    return np.dstack([im.astype(np.float32) / 255.0, mask])


def shot_on_white(photo: Path) -> bool:
    """True when the photo's border is plain white, as shop product shots are."""
    im = cv2.imread(str(photo), cv2.IMREAD_COLOR)
    if im is None:
        return False
    small = cv2.resize(im, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    edge = np.concatenate([small[0], small[-1], small[:, 0], small[:, -1]])
    return float(np.median(edge.min(axis=1))) > 0.94


def cutout(photo: str, lifted) -> tuple:
    """Return (float RGBA trimmed to the piece, True when it is a whole photo)."""
    if lifted is not None:
        im = cv2.imread(str(lifted), cv2.IMREAD_UNCHANGED)
        if im is not None and im.ndim == 3 and im.shape[2] == 4:
            alpha = im[:, :, 3].astype(np.float32) / 255.0
            cover = float((alpha > 0.5).mean())
            if SPECK < cover < WHOLE:
                if shot_on_white(REPO / photo):
                    # The lift keeps the white inside hoops, rings, and chain
                    # loops. Let white through, so those read as openings.
                    whiteness = 1.0 - im[:, :, :3].min(axis=2).astype(np.float32) / 255.0
                    alpha = np.minimum(alpha, np.clip((whiteness - 0.035) / 0.07, 0, 1))
                ys, xs = np.where(alpha > 0.04)
                pad = 3
                y0, y1 = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + pad + 1)
                x0, x1 = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + pad + 1)
                rgba = np.dstack([im[:, :, :3].astype(np.float32) / 255.0, alpha])
                return rgba[y0:y1, x0:x1], False
    return soft_plate(REPO / photo), True


def fit(rgba: np.ndarray, side: int) -> np.ndarray:
    """Scale so the longest side is `side`. Premultiplied, so edges stay clean."""
    h, w = rgba.shape[:2]
    scale = side / max(h, w)
    if scale >= 1:
        return rgba
    pm = rgba.copy()
    pm[:, :, :3] *= pm[:, :, 3:4]
    pm = cv2.resize(pm, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    a = pm[:, :, 3:4]
    rgb = np.where(a > 1e-4, pm[:, :, :3] / np.maximum(a, 1e-4), 0)
    return np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])


def to_bytes(rgba: np.ndarray) -> np.ndarray:
    return (rgba * 255 + 0.5).astype(np.uint8)


def main() -> int:
    photos = piece_photos()
    if not photos:
        sys.exit("no pieces found in catalog.js or covet-collection.js")
    print(f"{len(photos)} pieces")

    cell = TINY + GUTTER * 2
    cols = int(np.ceil(np.sqrt(len(photos))))
    rows = int(np.ceil(len(photos) / cols))
    atlas = np.zeros((rows * cell, cols * cell, 4), np.uint8)
    pieces = {}
    whole = 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.rglob("*.webp"):
        old.unlink()

    with tempfile.TemporaryDirectory() as tmp:
        lifted = lift_all(photos, Path(tmp))
        for n, photo in enumerate(photos):
            rgba, is_whole = cutout(photo, lifted.get(photo))
            whole += is_whole

            large = to_bytes(fit(rgba, LARGE))
            rel = Path(photo).relative_to("images").with_suffix(".webp")
            target = OUT_DIR / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(target), large, [cv2.IMWRITE_WEBP_QUALITY, 84])

            tiny = to_bytes(fit(rgba, TINY))
            th, tw = tiny.shape[:2]
            x = (n % cols) * cell + GUTTER + (TINY - tw) // 2
            y = (n // cols) * cell + GUTTER + (TINY - th) // 2
            atlas[y:y + th, x:x + tw] = tiny
            entry = {"x": x, "y": y, "w": tw, "h": th, "src": target.relative_to(REPO).as_posix()}
            if is_whole:
                entry["whole"] = True
            pieces[photo] = entry

    atlas_path = OUT_DIR / "atlas.webp"
    cv2.imwrite(str(atlas_path), atlas, [cv2.IMWRITE_WEBP_QUALITY, 86])
    stamp = hashlib.sha1(atlas_path.read_bytes()).hexdigest()[:8]

    data = {
        "atlas": atlas_path.relative_to(REPO).as_posix(),
        "version": stamp,
        "width": atlas.shape[1],
        "height": atlas.shape[0],
        "pieces": pieces,
    }
    MANIFEST.write_text(
        "/* Written by tools/canvas_build.py. Do not edit by hand. */\n"
        "window.COVET_CANVAS = " + json.dumps(data, indent=1) + ";\n"
    )

    total = sum(f.stat().st_size for f in OUT_DIR.rglob("*.webp"))
    print(f"atlas {atlas.shape[1]}x{atlas.shape[0]}, {atlas_path.stat().st_size / 1024:.0f} KB")
    print(f"{len(pieces) - whole} cutouts, {whole} kept as whole photos")
    print(f"images/canvas is {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
