"""Cut a flat-lay photo of cards into straight, named faces.

Each card is framed loosely, its true edges are measured, and one warp from
the original photo fills 1000x1727. A rounded alpha uses the measured corner
radius.

Add a sheet when the next photo lands: three or four rows, left to right,
top to bottom. Then run:

    .venv/bin/python tools/extract_cards.py
"""

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "images" / "cards"
WIDTH = 1000
HEIGHT = round(WIDTH * 4.75 / 2.75)
DEST = np.array([
    [0, 0],
    [WIDTH - 1, 0],
    [WIDTH - 1, HEIGHT - 1],
    [0, HEIGHT - 1],
], dtype=np.float32)
SIDES = ("left", "right", "top", "bottom")
CORNERS = ("top-left", "top-right", "bottom-right", "bottom-left")
# Middle 64% of each side, skipping the rounded corners.
SIDE_START = 0.18
SIDE_STOP = 0.82

SHEETS = [
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6775.jpg"),
        "grid": [
            ["jack-of-clubs", "jack-of-hearts", "jack-of-spades", "jack-of-diamonds"],
            ["10-of-clubs", "10-of-hearts", "10-of-spades", "10-of-diamonds"],
            ["9-of-clubs", "9-of-hearts", "9-of-spades", "9-of-diamonds"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6774.jpg"),
        "grid": [
            ["queen-of-hearts", "queen-of-clubs", "queen-of-spades", "queen-of-diamonds"],
            ["king-of-clubs", "king-of-spades", "king-of-hearts", "king-of-diamonds"],
            ["ace-of-spades", "ace-of-clubs", "ace-of-hearts", "ace-of-diamonds"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6782.jpg"),
        "edge": "drop",
        "grid": [
            ["8-of-clubs", "8-of-spades", "8-of-hearts", "8-of-diamonds"],
            ["7-of-clubs", "7-of-spades", "7-of-hearts", "7-of-diamonds"],
            ["6-of-spades", "6-of-clubs", "6-of-diamonds", "6-of-hearts"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6783.jpg"),
        "edge": "drop",
        "grid": [
            ["5-of-clubs", "5-of-spades", "5-of-hearts", "5-of-diamonds"],
            ["4-of-clubs", "4-of-spades", "4-of-hearts", "4-of-diamonds"],
            ["3-of-clubs", "3-of-spades", "3-of-hearts", "3-of-diamonds"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6784.jpg"),
        "rotate": "cw",
        "edge": "drop",
        "grid": [
            ["2-of-diamonds"],
            ["2-of-hearts"],
            ["2-of-spades"],
            ["2-of-clubs"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6785.jpg"),
        "edge": "drop",
        "grid": [
            ["joker-teal", "joker-copper"],
        ],
    },
    {
        "src": Path("/Users/cinemaninja/Downloads/IMG_6786.jpg"),
        "max_area": 0.22,
        "edge": "drop",
        "grid": [
            ["back-red", "back-blue"],
        ],
    },
]


def find_cards(image, max_frac=0.12):
    height, width = image.shape[:2]
    scale = 1400 / max(height, width)
    small = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame = small.shape[0] * small.shape[1]
    quads = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if not (frame * 0.015 < area < frame * max_frac):
            continue
        rect = cv2.minAreaRect(contour)
        side_w, side_h = rect[1]
        if min(side_w, side_h) < 20:
            continue
        aspect = max(side_w, side_h) / min(side_w, side_h)
        if not (1.45 < aspect < 2.05):
            continue
        box = cv2.boxPoints(rect).astype(np.float32) / scale
        quads.append(box)
    return quads


def order_corners(pts):
    pts = pts.reshape(4, 2).astype(np.float32)
    total = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array([
        pts[np.argmin(total)],
        pts[np.argmin(diff)],
        pts[np.argmax(total)],
        pts[np.argmax(diff)],
    ], dtype=np.float32)


def edge_margin(line, dark=46, run=8, mode="strict"):
    """Index of the card rim, scanning inward along one line.

    Strict mode wants the near-black stock of the first photos. Drop mode
    follows the sharp fall off the white table, for the brighter photos
    where the stock itself is lighter than that.
    """
    if mode == "drop":
        limit = len(line) - 12
        for i in range(4, max(4, limit)):
            window = line[i:i + 12]
            if window.mean() >= 74 or window.max() >= 90:
                continue
            if line[i - 8:i].mean() < window.mean() + 25:
                continue
            return i
        return None
    limit = len(line) - run
    for i in range(max(0, limit)):
        if line[i] < dark and line[i:i + run].mean() < dark + 12:
            return i
    return None


def rows_of(quads, row_count):
    ranked = sorted(quads, key=lambda q: q.mean(axis=0)[1])
    if len(ranked) != row_count * 4 and len(ranked) % row_count == 0:
        pass
    rows = []
    per = len(ranked) // row_count
    for i in range(row_count):
        chunk = ranked[i * per:(i + 1) * per]
        chunk.sort(key=lambda q: q.mean(axis=0)[0])
        rows.append(chunk)
    return rows


def scale_about_centroid(points, factor):
    center = points.mean(axis=0)
    return (center + (points - center) * factor).astype(np.float32)


def warp_to_card(image, corners, interpolation):
    matrix = cv2.getPerspectiveTransform(corners.astype(np.float32), DEST)
    return cv2.warpPerspective(image, matrix, (WIDTH, HEIGHT), flags=interpolation)


def scan_edge(gray, side, mode="strict"):
    """Margins along the middle 64% of one frame side. Step is 2 or 3 px."""
    height, width = gray.shape
    samples = []
    if side in ("left", "right"):
        coords = range(int(height * SIDE_START), int(height * SIDE_STOP), 3)
        for y in coords:
            line = gray[y] if side == "left" else gray[y, ::-1]
            found = edge_margin(line, mode=mode)
            if found is None:
                continue
            cap = (height if side in ("top", "bottom") else width) * 0.18
            if mode == "drop" and found > cap:
                continue
            samples.append((float(y), float(found)))
    else:
        coords = range(int(width * SIDE_START), int(width * SIDE_STOP), 2)
        for x in coords:
            line = gray[:, x] if side == "top" else gray[::-1, x]
            found = edge_margin(line, mode=mode)
            if found is None:
                continue
            cap = (height if side in ("top", "bottom") else width) * 0.18
            if mode == "drop" and found > cap:
                continue
            samples.append((float(x), float(found)))
    return samples, len(coords)


def consensus_line(pts):
    """Line with the most samples inside 3 px.

    A single polyfit of every sample follows the inner picture when a thin
    stretch of border fails the 8 px darkness run. Those misses sit far inside
    the card and lever the slope. Two-point fits ignore that leverage; the
    one that collects the most samples is the outer rim.
    """
    count = len(pts)
    step = max(1, count // 30)
    gap = max(1, count // 5)
    best_count = -1
    best = None
    for i in range(0, count, step):
        for j in range(i + gap, count, step):
            slope, intercept = np.polyfit(pts[[i, j], 0], pts[[i, j], 1], 1)
            residual = np.abs(slope * pts[:, 0] + intercept - pts[:, 1])
            hits = int(np.count_nonzero(residual <= 3))
            if hits > best_count:
                best_count = hits
                best = (float(slope), float(intercept))
    if best is None:
        return None
    return best


def outer_cluster(samples):
    """Keep the rim closest to the outside when some scans slip into the artwork."""
    if len(samples) < 30:
        return samples
    margins = np.array([sample[1] for sample in samples], dtype=np.float64)
    order = np.argsort(margins)
    chosen = [int(order[0])]
    for index in order[1:]:
        index = int(index)
        if len(chosen) >= 30 and margins[index] - margins[chosen[-1]] > 30:
            break
        if len(chosen) >= 30 and margins[index] - margins[chosen[0]] > 45:
            break
        chosen.append(index)
    return [samples[index] for index in chosen]


def fit_margin_line(samples, n_scan, name, side, partial=False):
    """Robust line: consensus polyfit, drop residuals over 3 px, refit, once more."""
    pts = np.asarray(samples, dtype=np.float64)
    if pts.ndim != 2 or len(pts) < 8:
        found = 0 if pts.ndim != 2 else len(pts)
        raise SystemExit(f"{name} {side}: only {found} of {n_scan} scans hit the rim")
    seeded = consensus_line(pts)
    if seeded is None:
        raise SystemExit(f"{name} {side}: could not fit a rim")
    slope, intercept = seeded
    keep = pts
    for _ in range(2):
        residual = np.abs(slope * keep[:, 0] + intercept - keep[:, 1])
        keep = keep[residual <= 3]
        if len(keep) < 8:
            raise SystemExit(f"{name} {side}: fewer than 8 points within 3 px of the rim")
        slope, intercept = np.polyfit(keep[:, 0], keep[:, 1], 1)
    if len(keep) / n_scan < 0.60:
        # A glossy edge wobbles a few pixels around a real straight rim.
        slope, intercept = np.polyfit(pts[:, 0], pts[:, 1], 1)
        residual = np.abs(slope * pts[:, 0] + intercept - pts[:, 1])
        keep = pts[residual <= 16]
        if len(keep) / n_scan < 0.90:
            if not (partial and len(pts) >= 40):
                raise SystemExit(f"{name} {side}: only {len(keep)} of {n_scan} samples survived")
            slope, intercept = np.polyfit(pts[:, 0], pts[:, 1], 1)
            residual = np.abs(slope * pts[:, 0] + intercept - pts[:, 1])
            keep = pts[residual <= 10]
            if len(keep) < 40 or len(keep) / len(pts) < 0.65:
                raise SystemExit(f"{name} {side}: only {len(keep)} of {n_scan} samples survived")
        slope, intercept = np.polyfit(keep[:, 0], keep[:, 1], 1)
    residual = np.abs(slope * pts[:, 0] + intercept - pts[:, 1])
    kept_residual = np.abs(slope * keep[:, 0] + intercept - keep[:, 1])
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "n_scan": int(n_scan),
        "n_kept": int(len(keep)),
        "positions": keep[:, 0],
        "margins": keep[:, 1],
        "residual": kept_residual,
        "all_positions": pts[:, 0],
        "all_margins": pts[:, 1],
        "all_residual": residual,
    }


def edge_line(side, fit):
    """ax + by + c = 0 for one fitted rim, in loose-image pixels."""
    slope = fit["slope"]
    intercept = fit["intercept"]
    if side == "left":
        return 1.0, -slope, -intercept
    if side == "right":
        return 1.0, slope, intercept - (WIDTH - 1)
    if side == "top":
        return -slope, 1.0, -intercept
    return slope, 1.0, intercept - (HEIGHT - 1)


def intersect_lines(first, second, name):
    a1, b1, c1 = first
    a2, b2, c2 = second
    det = a1 * b2 - a2 * b1
    if abs(det) < 1e-8:
        raise SystemExit(f"{name}: fitted edges are parallel")
    x = (b1 * c2 - b2 * c1) / det
    y = (c1 * a2 - c2 * a1) / det
    return np.array([x, y], dtype=np.float64)


def fitted_corners(fits, name):
    lines = {side: edge_line(side, fits[side]) for side in SIDES}
    corners = np.array([
        intersect_lines(lines["left"], lines["top"], name),
        intersect_lines(lines["right"], lines["top"], name),
        intersect_lines(lines["right"], lines["bottom"], name),
        intersect_lines(lines["left"], lines["bottom"], name),
    ], dtype=np.float64)
    if not np.isfinite(corners).all():
        raise SystemExit(f"{name}: fitted corners are not finite")
    if (corners[:, 0] < 0).any() or (corners[:, 0] > WIDTH - 1).any():
        raise SystemExit(f"{name}: fitted corner is outside the loose frame horizontally {corners.tolist()}")
    if (corners[:, 1] < 0).any() or (corners[:, 1] > HEIGHT - 1).any():
        raise SystemExit(f"{name}: fitted corner is outside the loose frame vertically {corners.tolist()}")
    span = corners.max(axis=0) - corners.min(axis=0)
    if span[0] < WIDTH * 0.6 or span[1] < HEIGHT * 0.6:
        raise SystemExit(f"{name}: fitted card is too small ({span[0]:.0f} x {span[1]:.0f})")
    return corners


def sample_ray(gray, origin, unit, count):
    """Gray samples every 1 px from origin along a unit direction."""
    height, width = gray.shape
    steps = np.arange(count, dtype=np.float64)
    xs = float(origin[0]) + float(unit[0]) * steps
    ys = float(origin[1]) + float(unit[1]) * steps
    inside = (xs >= 0) & (ys >= 0) & (xs <= width - 2) & (ys <= height - 2)
    if not inside.all():
        if not inside[0]:
            return np.empty(0, dtype=np.float64)
        count = int(np.argmax(~inside))
        xs = xs[:count]
        ys = ys[:count]
    x0 = np.floor(xs).astype(np.int32)
    y0 = np.floor(ys).astype(np.int32)
    wx = xs - x0
    wy = ys - y0
    line = (
        gray[y0, x0] * (1.0 - wx) * (1.0 - wy)
        + gray[y0, x0 + 1] * wx * (1.0 - wy)
        + gray[y0 + 1, x0] * (1.0 - wx) * wy
        + gray[y0 + 1, x0 + 1] * wx * wy
    )
    return np.asarray(line, dtype=np.float64)


def card_width(corners):
    top = np.linalg.norm(corners[1] - corners[0])
    bottom = np.linalg.norm(corners[2] - corners[3])
    return float((top + bottom) / 2)


def corner_bisector(corners, index):
    """Inward 45° diagonal. The card is taller than it is wide, so the line
    from the corner to the centroid is not the bisector the radius formula uses.
    """
    corner = corners[index]
    toward_a = corners[(index - 1) % 4] - corner
    toward_b = corners[(index + 1) % 4] - corner
    toward_a = toward_a / np.linalg.norm(toward_a)
    toward_b = toward_b / np.linalg.norm(toward_b)
    bisector = toward_a + toward_b
    return bisector / np.linalg.norm(bisector)


def corner_fractions(gray, corners, name, edge="strict"):
    """Radius / card width at each corner. Radius is d / (sqrt(2) - 1)."""
    width = card_width(corners)
    fractions = []
    rays = []
    for index, corner in enumerate(corners):
        line = sample_ray(gray, corner, corner_bisector(corners, index), 160)
        distance = edge_margin(line, mode=edge)
        if distance is None:
            continue
        radius = distance / (np.sqrt(2) - 1)
        fractions.append(radius / width)
        rays.append(int(distance))
    if len(fractions) < 2:
        raise SystemExit(f"{name}: only {len(fractions)} corners met the rim")
    return fractions, rays, width


def turn_upright(ordered, rotate):
    """A card photographed on its side has the long edge across the top of the frame."""
    if rotate == "cw":
        return np.array([ordered[3], ordered[0], ordered[1], ordered[2]], np.float32)
    if rotate == "ccw":
        return np.array([ordered[1], ordered[2], ordered[3], ordered[0]], np.float32)
    return ordered


def measure_card(image, quad, name, rotate=None, edge="strict"):
    ordered = turn_upright(order_corners(quad), rotate)
    expanded = scale_about_centroid(ordered, 1.10)
    homography = cv2.getPerspectiveTransform(expanded, DEST)
    loose = cv2.warpPerspective(image, homography, (WIDTH, HEIGHT), flags=cv2.INTER_LINEAR)
    gray = cv2.cvtColor(loose, cv2.COLOR_BGR2GRAY)
    fits = {}
    for side in SIDES:
        samples, n_scan = scan_edge(gray, side, edge)
        if edge == "drop":
            samples = outer_cluster(samples)
        fits[side] = fit_margin_line(samples, n_scan, name, side, partial=(edge == "drop"))
    corners = fitted_corners(fits, name)
    fractions, rays, width = corner_fractions(gray, corners, name, edge)
    source = cv2.perspectiveTransform(
        corners.reshape(1, -1, 2).astype(np.float64),
        np.linalg.inv(homography),
    ).reshape(-1, 2)
    return {
        "name": name,
        "image": image,
        "fits": fits,
        "homography": homography,
        "loose_corners": corners,
        "source_corners": source.astype(np.float32),
        "fractions": fractions,
        "rays": rays,
        "card_width": width,
    }


def rounded_alpha(bgr, radius_frac=0.048):
    """Hard rounded marquee. Interior photo pixels stay as they are."""
    height, width = bgr.shape[:2]
    radius = radius_frac * width
    pad = 0
    x0, y0, x1, y1 = pad, pad, width - 1 - pad, height - 1 - pad
    yy, xx = np.ogrid[0:height, 0:width]
    half_w = (x1 - x0) / 2
    half_h = (y1 - y0) / 2
    qx = np.abs(xx - (x0 + x1) / 2) - (half_w - radius)
    qy = np.abs(yy - (y0 + y1) / 2) - (half_h - radius)
    outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
    inside = np.minimum(np.maximum(qx, qy), 0)
    alpha = np.clip(0.5 - (outside + inside - radius), 0, 1)
    return np.dstack([bgr, (alpha * 255).astype(np.uint8)])


def band(gray, side, kind):
    """Inside band is 2..5 px from the edge. Outside band is the outer 3 px."""
    height, width = gray.shape
    y0, y1 = int(height * 0.15), int(height * 0.85)
    x0, x1 = int(width * 0.15), int(width * 0.85)
    if side == "left":
        return gray[y0:y1, 2:6] if kind == "inside" else gray[y0:y1, 0:3]
    if side == "right":
        cols = gray[y0:y1, width - 6:width - 2] if kind == "inside" else gray[y0:y1, width - 3:width]
        return cols
    if side == "top":
        return gray[2:6, x0:x1] if kind == "inside" else gray[0:3, x0:x1]
    return gray[height - 6:height - 2, x0:x1] if kind == "inside" else gray[height - 3:height, x0:x1]


def print_fit(job):
    """Fitted margins and residuals for a card that failed the edge check."""
    name = job["name"]
    for side in SIDES:
        fit = job["fits"][side]
        dropped = fit["all_residual"] > 3
        print(
            f"  {name} {side}: slope {fit['slope']:.5f} intercept {fit['intercept']:.2f} "
            f"kept {fit['n_kept']}/{fit['n_scan']} "
            f"margin {fit['margins'].min():.1f}..{np.median(fit['margins']):.1f}..{fit['margins'].max():.1f} "
            f"resid max {fit['residual'].max():.2f}"
        )
        if dropped.any():
            bits = []
            for pos, margin, residual in zip(
                fit["all_positions"][dropped],
                fit["all_margins"][dropped],
                fit["all_residual"][dropped],
            ):
                bits.append(f"({pos:.0f}, {margin:.1f}, Δ{residual:.1f})")
            print(f"    residual > 3 px: {', '.join(bits[:40])}")
    loose = job["loose_corners"]
    print(f"  {name} loose corners {np.round(loose, 1).tolist()}")
    print(f"  {name} source corners {np.round(job['source_corners'], 1).tolist()}")
    print(f"  {name} rays {job['rays']} width {job['card_width']:.1f}")


def audit_card(name, final_bgr, check_bgr, job):
    """Inside the crop must be card stock. Just outside it must not be."""
    final_gray = cv2.cvtColor(final_bgr, cv2.COLOR_BGR2GRAY)
    check_gray = cv2.cvtColor(check_bgr, cv2.COLOR_BGR2GRAY)
    inside = []
    outside = []
    inside_patch = []
    outside_patch = []
    for side in SIDES:
        inner = band(final_gray, side, "inside")
        outer = band(check_gray, side, "outside")
        inside.append(100.0 * np.count_nonzero(inner < 88) / inner.size)
        # A deep cast shadow is darker than gray 55 but still lighter than the
        # stock beside it, so compare with this side's own stock.
        stock = float(np.median(inner))
        outside.append(100.0 * np.count_nonzero(outer > stock + 12) / outer.size)
        inside_patch.append(inner)
        outside_patch.append(outer)
    ok = all(value >= 74 for value in inside) and all(value >= 50 for value in outside)
    labels = ("L", "R", "T", "B")
    inn = "  ".join(f"{label} {value:5.1f}" for label, value in zip(labels, inside))
    out = "  ".join(f"{label} {value:5.1f}" for label, value in zip(labels, outside))
    print(f"{name:<20} in  {inn}   out  {out}   {'PASS' if ok else 'FAIL'}")
    if not ok:
        for label, value, patch in zip(labels, inside, inside_patch):
            if value < 80:
                print(f"  {name} inside {label} median gray {np.median(patch):.0f}")
        for label, value, patch in zip(labels, outside, outside_patch):
            if value < 85:
                print(f"  {name} outside {label} median gray {np.median(patch):.0f}")
        print_fit(job)
    return ok


def contact_thumb(face, name):
    bgr = face[:, :, :3].astype(np.float32)
    alpha = face[:, :, 3:4].astype(np.float32) / 255
    shown = bgr * alpha + np.array([180, 0, 180], np.float32) * (1 - alpha)
    thumb = cv2.resize(shown.astype(np.uint8), (180, round(180 * 4.75 / 2.75)), interpolation=cv2.INTER_AREA)
    cv2.putText(thumb, name, (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(thumb, name, (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1, cv2.LINE_AA)
    return thumb


def print_margin_summary(jobs):
    parts = []
    for side in SIDES:
        values = np.concatenate([job["fits"][side]["margins"] for job in jobs])
        parts.append(f"{side} {values.min():.0f}-{values.max():.0f}")
    print("loose-frame margins " + "  ".join(parts))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for sheet in SHEETS:
        image = cv2.imread(str(sheet["src"]))
        if image is None:
            raise SystemExit(f"could not read {sheet['src']}")
        quads = find_cards(image, sheet.get("max_area", 0.12))
        grid = sheet["grid"]
        expected = sum(len(row) for row in grid)
        if len(quads) != expected:
            raise SystemExit(f"{sheet['src'].name}: found {len(quads)} cards, expected {expected}")
        for names, quads_in_row in zip(grid, rows_of(quads, len(grid))):
            if len(quads_in_row) != len(names):
                raise SystemExit(f"{sheet['src'].name}: row length mismatch")
            for name, quad in zip(names, quads_in_row):
                jobs.append(measure_card(image, quad, name, sheet.get("rotate"), sheet.get("edge", "strict")))

    fractions = np.concatenate([job["fractions"] for job in jobs])
    median = float(np.median(fractions))
    print(
        f"corner radius {median * 100:.2f}% of width "
        f"(median of {len(fractions)}, min {fractions.min() * 100:.2f}%, max {fractions.max() * 100:.2f}%)"
    )
    # A ray through the centroid instead of the corner bisector reads about 7%.
    # The bisector is what d / (sqrt(2) - 1) measures, and that lands just
    # above 6.5% because these corners really are that round.
    if not (0.035 <= median <= 0.070):
        for job in jobs:
            vals = " ".join(f"{value * 100:.2f}" for value in job["fractions"])
            rays = " ".join(str(distance) for distance in job["rays"])
            print(f"  {job['name']} radius% {vals}  ray {rays}  width {job['card_width']:.1f}")
        raise SystemExit("corner radius is outside 3.5% to 6.5% of card width")
    mask_frac = median + 0.003
    print(f"mask radius {mask_frac * 100:.2f}% of width")
    print_margin_summary(jobs)

    failed = False
    faces = []
    debug = Path("/tmp/card-debug")
    for job in jobs:
        final_corners = scale_about_centroid(job["source_corners"], 0.997)
        final = warp_to_card(job["image"], final_corners, cv2.INTER_CUBIC)
        check = warp_to_card(job["image"], scale_about_centroid(final_corners, 1.015), cv2.INTER_LINEAR)
        if audit_card(job["name"], final, check, job):
            faces.append((job["name"], rounded_alpha(final, mask_frac)))
        else:
            failed = True
            debug.mkdir(exist_ok=True)
            cv2.imwrite(str(debug / f"{job['name']}-final.jpg"), final, [cv2.IMWRITE_JPEG_QUALITY, 90])
            cv2.imwrite(str(debug / f"{job['name']}-check.jpg"), check, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if failed:
        raise SystemExit(1)

    thumbs = []
    for name, face in faces:
        dest = OUT / f"{name}.png"
        cv2.imwrite(str(dest), face, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        thumbs.append(contact_thumb(face, name))
        print(dest.name, face.shape[1], "x", face.shape[0])
    cols = 6
    blank = np.zeros_like(thumbs[0])
    rows = []
    for i in range(0, len(thumbs), cols):
        row = thumbs[i:i + cols]
        if len(row) < cols:
            row = row + [blank] * (cols - len(row))
        rows.append(np.concatenate(row, axis=1))
    sheet_img = np.concatenate(rows, axis=0)
    preview = Path("/tmp/card-debug/contact.jpg")
    preview.parent.mkdir(exist_ok=True)
    cv2.imwrite(str(preview), sheet_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print("preview", preview)


if __name__ == "__main__":
    main()
