"""Write a small fan WebP and a sharp hover WebP for each trimmed card.

The PNG masters stay in images/cards. The site only requests the WebPs.
"""

from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "images" / "cards"
SMALL = SRC / "sm"
LARGE = SRC / "lg"
SMALL_W = 560
LARGE_Q = 84
SMALL_Q = 80


def write(image, path, quality):
    path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(path), image, [cv2.IMWRITE_WEBP_QUALITY, quality])
    if not ok:
        raise SystemExit(f"could not write {path}")


def main():
    files = sorted(SRC.glob("*.png"))
    if not files:
        raise SystemExit(f"no png masters in {SRC}")
    total_sm = total_lg = 0
    for src in files:
        image = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
        if image is None or image.ndim != 3 or image.shape[2] != 4:
            raise SystemExit(f"expected a transparent png: {src.name}")
        height, width = image.shape[:2]
        small_h = round(SMALL_W * height / width)
        small = cv2.resize(image, (SMALL_W, small_h), interpolation=cv2.INTER_AREA)
        write(small, SMALL / f"{src.stem}.webp", SMALL_Q)
        write(image, LARGE / f"{src.stem}.webp", LARGE_Q)
        total_sm += (SMALL / f"{src.stem}.webp").stat().st_size
        total_lg += (LARGE / f"{src.stem}.webp").stat().st_size
        print(src.stem)
    print(f"fan {total_sm/1e6:.2f} MB   sharp {total_lg/1e6:.2f} MB   cards {len(files)}")


if __name__ == "__main__":
    main()
