"""Scan and serve host Mac Font Book files mounted into Docker (or local paths)."""
from __future__ import annotations

import os
import struct
from pathlib import Path

FONT_EXTS = {'.ttf', '.otf', '.ttc', '.woff', '.woff2'}
_EXT_RANK = {'.woff2': 0, '.woff': 1, '.otf': 2, '.ttf': 3, '.ttc': 4}
_SKIP_NAME_PARTS = ('emoji', 'braille', 'lastresort', 'color.ttf', 'apple color')

_cache: list[dict] | None = None
_by_id: dict[str, Path] = {}


def fonts_roots() -> list[Path]:
    raw = (os.environ.get('ROBY_LAYOUT_FONTS_ROOT') or '').strip()
    if raw:
        roots = [Path(p).expanduser().resolve() for p in raw.split(':') if p.strip()]
    else:
        # Prefer shareable Mac paths. In Docker only ~/Library/Fonts is mountable
        # (Docker Desktop File Sharing: /Users + /Volumes; not /System or /Library).
        roots = [
            Path('/System/Library/Fonts').resolve(),
            Path('/Library/Fonts').resolve(),
            (Path.home() / 'Library' / 'Fonts').resolve(),
            Path('/host-fonts/user').resolve(),
            Path('/host-fonts').resolve(),
        ]
    out = []
    for r in roots:
        try:
            if r.exists() and r.is_dir() and r not in out:
                out.append(r)
        except OSError:
            continue
    return out


def _u16(data: bytes, off: int) -> int:
    return struct.unpack_from('>H', data, off)[0]


def _u32(data: bytes, off: int) -> int:
    return struct.unpack_from('>I', data, off)[0]


def _decode_name(raw: bytes, platform: int, encoding: int) -> str | None:
    try:
        if platform == 3 or (platform == 0 and encoding in (3, 4)):
            return raw.decode('utf-16-be').strip('\x00').strip() or None
        if platform == 1:
            return raw.decode('mac_roman', errors='ignore').strip() or None
        return raw.decode('utf-8', errors='ignore').strip() or None
    except Exception:
        return None


def _family_from_sfnt(data: bytes, offset: int = 0) -> str | None:
    if len(data) < offset + 12:
        return None
    num_tables = _u16(data, offset + 4)
    cursor = offset + 12
    name_off = name_len = None
    for _ in range(num_tables):
        if cursor + 16 > len(data):
            break
        tag = data[cursor:cursor + 4]
        if tag == b'name':
            name_off = _u32(data, cursor + 8)
            name_len = _u32(data, cursor + 12)
            break
        cursor += 16
    if name_off is None or name_len is None:
        return None
    base = name_off
    if base + 6 > len(data):
        return None
    count = _u16(data, base + 2)
    storage = base + _u16(data, base + 4)
    best: dict[int, str] = {}
    for i in range(count):
        rec = base + 6 + i * 12
        if rec + 12 > len(data):
            break
        platform, encoding, _lang, name_id = (_u16(data, rec + j) for j in (0, 2, 4, 6))
        length, str_off = _u16(data, rec + 8), _u16(data, rec + 10)
        if name_id not in (1, 16):
            continue
        start = storage + str_off
        chunk = data[start:start + length]
        text = _decode_name(chunk, platform, encoding)
        if text:
            best[name_id] = text
    return best.get(16) or best.get(1)


def read_font_family(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if len(data) < 12:
        return None
    if data[:4] == b'ttcf':
        num = _u32(data, 8)
        if num < 1 or 12 + 4 > len(data):
            return None
        face_off = _u32(data, 12)
        return _family_from_sfnt(data, face_off)
    if data[:4] in (b'OTTO', b'\x00\x01\x00\x00', b'true'):
        return _family_from_sfnt(data, 0)
    # woff/woff2: use filename stem
    return None


def _should_skip(path: Path, family: str) -> bool:
    if family.startswith('.'):
        return True
    blob = f'{path.name} {family}'.lower()
    return any(s in blob for s in _SKIP_NAME_PARTS)


def _family_from_path(path: Path) -> str:
    name = read_font_family(path)
    if name:
        return name
    stem = path.stem
    for suffix in ('-Regular', '-Bold', '-Italic', '-Light', '-Medium', '-Black'):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem.replace('_', ' ').strip() or path.name


def scan_host_fonts(force: bool = False) -> list[dict]:
    global _cache, _by_id
    if _cache is not None and not force:
        return _cache
    roots = fonts_roots()
    by_family: dict[str, dict] = {}
    _by_id = {}
    idx = 0
    for root in roots:
        try:
            files = sorted(root.rglob('*'))
        except OSError:
            continue
        for path in files:
            if not path.is_file() or path.suffix.lower() not in FONT_EXTS:
                continue
            family = _family_from_path(path)
            if not family or _should_skip(path, family):
                continue
            key = family.casefold()
            ext = path.suffix.lower()
            rank = _EXT_RANK.get(ext, 9)
            existing = by_family.get(key)
            # Prefer single-face formats over .ttc; later roots still override equal/worse ranks
            if existing and _EXT_RANK.get(existing['ext'], 9) < rank:
                continue
            if existing:
                _by_id.pop(existing['id'], None)
            fid = f'f{idx}'
            idx += 1
            _by_id[fid] = path.resolve()
            by_family[key] = {
                'id': fid,
                'family': family,
                'url': f'/api/font-file?id={fid}',
                'ext': ext,
            }
    _cache = sorted(by_family.values(), key=lambda x: x['family'].casefold())
    return _cache


def resolve_font_file(font_id: str) -> Path:
    scan_host_fonts()
    path = _by_id.get(font_id)
    if path is None or not path.is_file():
        raise ValueError(f'Unknown font id: {font_id}')
    roots = fonts_roots()
    if not any(path == r or r in path.parents for r in roots):
        raise ValueError('Font outside fonts roots')
    return path


def fonts_payload() -> dict:
    fonts = scan_host_fonts()
    return {
        'ok': True,
        'count': len(fonts),
        'roots': [str(r) for r in fonts_roots()],
        'fonts': [{'id': f['id'], 'family': f['family'], 'url': f['url']} for f in fonts],
    }
