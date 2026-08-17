"""Reading pixels and cutting files, the part of ad work that used to need a script.

Two jobs live here. Measuring: where is the dark phone screen in this photo, what
quadrilateral does it occupy, how rounded are its corners — the numbers a warped
mockup layer needs. And editing: crop, resize, pad, so a source photo can be brought
to size without leaving the editor's world.
"""
from __future__ import annotations

from pathlib import Path

RESAMPLE = 'lanczos'
_RESAMPLE_MAP = {
    'nearest': 0, 'bilinear': 2, 'bicubic': 3, 'lanczos': 1,
}


def _pil():
    try:
        from PIL import Image
        return Image
    except ImportError as e:  # pragma: no cover - environment problem, not logic
        raise RuntimeError('Pillow non installato: pip install -r requirements.txt') from e


def _np():
    try:
        import numpy as np
        return np
    except ImportError as e:  # pragma: no cover
        raise RuntimeError('numpy non installato: pip install -r requirements.txt') from e


def image_info(path: Path) -> dict:
    Image = _pil()
    with Image.open(path) as im:
        return {'width': im.width, 'height': im.height, 'mode': im.mode,
                'format': im.format, 'has_alpha': im.mode in ('RGBA', 'LA')}


# ----------------------------------------------------------------- measuring

def _mask_for(arr, mode: str, threshold: float, np):
    """Boolean mask of the region of interest, in the caller's terms."""
    if mode == 'alpha':
        if arr.shape[2] < 4:
            raise ValueError('image has no alpha channel: use mode="dark" or "bright"')
        return arr[:, :, 3] > (threshold * 255)
    lum = arr[:, :, :3].astype('float32').mean(axis=2)
    if mode == 'bright':
        return lum > (threshold * 255)
    return lum < (threshold * 255)      # 'dark', the switched-off screen case


def _largest_component(mask, np):
    """Biggest 4-connected blob, found with a two-pass union-find over rows.

    scipy would be one call, but it is a heavy dependency for one label pass and the
    server already ships without it.
    """
    h, w = mask.shape
    labels = np.zeros((h, w), dtype='int32')
    parent: list[int] = [0]

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    nxt = 1
    for y in range(h):
        row = mask[y]
        for x in np.flatnonzero(row):
            up = labels[y - 1, x] if y else 0
            left = labels[y, x - 1] if x else 0
            if up and left:
                labels[y, x] = min(up, left)
                union(up, left)
            elif up or left:
                labels[y, x] = up or left
            else:
                labels[y, x] = nxt
                parent.append(nxt)
                nxt += 1
    if nxt == 1:
        return None
    roots = np.array([find(i) for i in range(nxt)], dtype='int32')
    flat = roots[labels]
    counts = np.bincount(flat.ravel())
    counts[0] = 0
    best = int(counts.argmax())
    if not counts[best]:
        return None
    return flat == best


def _fit_line(a, b, np):
    """Least squares b = m*a + q, as (m, q). Fewer than two points means no line."""
    if len(a) < 2:
        return None
    m, q = np.polyfit(a.astype('float64'), b.astype('float64'), 1)
    return float(m), float(q)


def _corners_of(mask, np) -> list[dict]:
    """The four corners of the quadrilateral, ordered TL, TR, BR, BL.

    Not the extreme points of the blob: on a rounded screen those sit on the arc, tens
    of pixels inside the corner a warped layer has to land on. Each side is fitted as a
    line through the middle of its own edge — away from the rounding — and the corners
    are where those lines meet. Perspective keeps straight lines straight, so a phone
    photographed at an angle is fitted just as exactly as a flat one.
    """
    ys, xs = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    h, w = y1 - y0, x1 - x0
    if h < 4 or w < 4:
        return [{'x': float(x0), 'y': float(y0)}, {'x': float(x1), 'y': float(y0)},
                {'x': float(x1), 'y': float(y1)}, {'x': float(x0), 'y': float(y1)}]

    rows = np.arange(y0 + int(h * 0.25), y0 + int(h * 0.75) + 1)
    cols = np.arange(x0 + int(w * 0.25), x0 + int(w * 0.75) + 1)
    left_x, right_x, top_y, bottom_y = [], [], [], []
    for y in rows:
        filled = np.flatnonzero(mask[y])
        if len(filled):
            left_x.append(filled[0]); right_x.append(filled[-1])
    for x in cols:
        filled = np.flatnonzero(mask[:, x])
        if len(filled):
            top_y.append(filled[0]); bottom_y.append(filled[-1])

    rows_used = rows[:len(left_x)]
    cols_used = cols[:len(top_y)]
    left = _fit_line(rows_used, np.array(left_x), np)        # x = m*y + q
    right = _fit_line(rows_used, np.array(right_x), np)
    top = _fit_line(cols_used, np.array(top_y), np)          # y = m*x + q
    bottom = _fit_line(cols_used, np.array(bottom_y), np)
    if not all((left, right, top, bottom)):
        return [{'x': float(x0), 'y': float(y0)}, {'x': float(x1), 'y': float(y0)},
                {'x': float(x1), 'y': float(y1)}, {'x': float(x0), 'y': float(y1)}]

    def meet(vert, horiz):
        """x = a*y + b against y = c*x + d."""
        a, b = vert
        c, d = horiz
        denom = 1 - a * c
        if abs(denom) < 1e-9:
            return None
        y = (c * b + d) / denom
        return {'x': round(a * y + b, 1), 'y': round(y, 1)}

    corners = [meet(left, top), meet(right, top), meet(right, bottom), meet(left, bottom)]
    if any(c is None for c in corners):
        return [{'x': float(x0), 'y': float(y0)}, {'x': float(x1), 'y': float(y0)},
                {'x': float(x1), 'y': float(y1)}, {'x': float(x0), 'y': float(y1)}]
    return corners


def _poly_area(points) -> float:
    n = len(points)
    return abs(sum(points[i]['x'] * points[(i + 1) % n]['y'] - points[(i + 1) % n]['x'] * points[i]['y']
                   for i in range(n))) / 2.0


def _corner_radius(mask, corners, np) -> float:
    """Measured at the corners themselves: how far in, along the diagonal, the shape starts.

    A circular fillet of radius r keeps its corner point r·(√2−1) away from the true
    corner, so that one distance gives r. Taken per corner and reduced to the median,
    which survives one corner clipped by the frame — the area of the whole blob does
    not: the rounding removes well under 1% of it, less than the error on the edge.
    """
    h, w = mask.shape
    cx = sum(c['x'] for c in corners) / 4.0
    cy = sum(c['y'] for c in corners) / 4.0
    found = []
    for corner in corners:
        dx, dy = cx - corner['x'], cy - corner['y']
        length = (dx * dx + dy * dy) ** 0.5
        if length < 2:
            continue
        dx, dy = dx / length, dy / length
        steps = int(min(length, max(h, w) / 2))
        for i in range(steps * 2):                     # half-pixel steps
            t = i / 2.0
            x, y = int(round(corner['x'] + dx * t)), int(round(corner['y'] + dy * t))
            if 0 <= x < w and 0 <= y < h and mask[y, x]:
                found.append(t / (2 ** 0.5 - 1))
                break
    if not found:
        return 0.0
    found.sort()
    mid = len(found) // 2
    median = found[mid] if len(found) % 2 else (found[mid - 1] + found[mid]) / 2
    return round(float(median), 1)


def measure_region(path: Path, *, mode: str = 'dark', threshold: float = 0.22,
                   max_side: int = 1400, min_area_ratio: float = 0.01) -> dict:
    """Locate a region in a photo and describe it in source pixels.

    mode: 'dark' (a switched-off screen, the default), 'bright', or 'alpha' (a cutout).
    The search runs on a downscaled copy for speed and the result is scaled back up,
    so the numbers are always in the coordinates of the file on disk.
    """
    Image, np = _pil(), _np()
    with Image.open(path) as src:
        im = src.convert('RGBA')
        full_w, full_h = im.width, im.height
        scale = min(1.0, max_side / max(full_w, full_h))
        if scale < 1.0:
            im = im.resize((max(1, int(full_w * scale)), max(1, int(full_h * scale))),
                           _RESAMPLE_MAP[RESAMPLE])
        arr = np.asarray(im)

    mask = _mask_for(arr, mode, threshold, np)
    blob = _largest_component(mask, np)
    if blob is None or blob.sum() < mask.size * min_area_ratio:
        return {'found': False, 'width': full_w, 'height': full_h,
                'hint': 'nessuna regione trovata: alza threshold o cambia mode'}

    k = 1.0 / (scale or 1.0)
    # Radius from the working-resolution mask and its own corners: mixing a scaled
    # quadrilateral with an unscaled mask would compare two different pictures.
    small_corners = _corners_of(blob, np)
    radius = _corner_radius(blob, small_corners, np) * k
    corners = [{'x': round(c['x'] * k, 1), 'y': round(c['y'] * k, 1)} for c in small_corners]
    ys, xs = np.nonzero(blob)
    box = {
        'x': round(float(xs.min()) * k, 1), 'y': round(float(ys.min()) * k, 1),
        'w': round(float(xs.max() - xs.min() + 1) * k, 1),
        'h': round(float(ys.max() - ys.min() + 1) * k, 1),
    }
    return {
        'found': True,
        'width': full_w, 'height': full_h,
        'mode': mode, 'threshold': threshold,
        'box': box,
        'quad': corners,                                  # TL, TR, BR, BL
        'corner_radius': round(radius, 1),
        'area_ratio': round(float(blob.sum()) / blob.size, 4),
        'warp': {                                         # ready for a warped image layer
            'x': box['x'], 'y': box['y'], 'w': box['w'], 'h': box['h'],
            'warpPoints': [
                {'x': round((c['x'] - box['x']) / box['w'], 4),
                 'y': round((c['y'] - box['y']) / box['h'], 4)}
                for c in corners
            ],
        },
    }


# ------------------------------------------------------------------ editing

def _out_path(src: Path, out, suffix: str) -> Path:
    if out:
        return Path(out)
    return src.with_name(f'{src.stem}-{suffix}{src.suffix or ".png"}')


def edit_image(path: Path, op: str, *, out: Path | None = None, **kw) -> dict:
    """crop | resize | fit | pad | rotate, always writing a new file.

    The source is never modified: an ad iterates, and a destructive crop would cost
    the original.
    """
    Image = _pil()
    op = (op or '').strip().lower()
    with Image.open(path) as src:
        im = src.convert('RGBA') if src.mode not in ('RGB', 'RGBA') else src.copy()

        if op == 'crop':
            box = (int(kw['x']), int(kw['y']), int(kw['x']) + int(kw['w']), int(kw['y']) + int(kw['h']))
            if box[0] < 0 or box[1] < 0 or box[2] > im.width or box[3] > im.height:
                raise ValueError(f'crop {box} outside image {im.width}x{im.height}')
            im = im.crop(box)
        elif op == 'resize':
            w, h = kw.get('w'), kw.get('h')
            if not w and not h:
                raise ValueError('resize needs w and/or h')
            if not w:
                w = round(im.width * (int(h) / im.height))
            if not h:
                h = round(im.height * (int(w) / im.width))
            im = im.resize((int(w), int(h)), _RESAMPLE_MAP[RESAMPLE])
        elif op == 'fit':
            # Cover the target box and centre-crop the overflow: the usual "make this
            # photo fill a 1080x1350 frame" move.
            w, h = int(kw['w']), int(kw['h'])
            factor = max(w / im.width, h / im.height)
            im = im.resize((max(1, round(im.width * factor)), max(1, round(im.height * factor))),
                           _RESAMPLE_MAP[RESAMPLE])
            left, top = (im.width - w) // 2, (im.height - h) // 2
            im = im.crop((left, top, left + w, top + h))
        elif op == 'pad':
            w, h = int(kw['w']), int(kw['h'])
            bg = kw.get('background') or (0, 0, 0, 0)
            canvas = Image.new('RGBA', (w, h), bg if isinstance(bg, tuple) else bg)
            factor = min(w / im.width, h / im.height)
            inner = im.resize((max(1, round(im.width * factor)), max(1, round(im.height * factor))),
                              _RESAMPLE_MAP[RESAMPLE])
            canvas.paste(inner, ((w - inner.width) // 2, (h - inner.height) // 2), inner if inner.mode == 'RGBA' else None)
            im = canvas
        elif op == 'rotate':
            im = im.rotate(-float(kw.get('degrees') or 0), expand=True, resample=_RESAMPLE_MAP['bicubic'])
        else:
            raise ValueError(f'unknown op: {op} (crop, resize, fit, pad, rotate)')

        target = _out_path(path, out, op)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix.lower() in ('.jpg', '.jpeg') and im.mode == 'RGBA':
            im = im.convert('RGB')
        im.save(target)
        return {'width': im.width, 'height': im.height, 'path': target}
