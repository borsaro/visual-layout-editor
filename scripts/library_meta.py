"""Folder-level metadata for the layout library: tags and file moves.

Tags live in a `.roby-tags.json` per folder ({filename: [tags]}), not inside the
layout files: the listing's light mode deliberately never opens the layouts, and
tags must not change that. Moving a file carries its tag entry and its sidecars
(preview, variants set, variants thumbnails) along.
"""
from __future__ import annotations

import json
from pathlib import Path

TAGS_INDEX = '.roby-tags.json'


def _index_path(folder: Path) -> Path:
    return folder / TAGS_INDEX


def load_tags_index(folder: Path) -> dict:
    p = _index_path(folder)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_tags_index(folder: Path, data: dict) -> None:
    p = _index_path(folder)
    clean = {k: v for k, v in data.items() if isinstance(v, list) and v}
    if not clean:
        if p.exists():
            p.unlink()
        return
    p.write_text(json.dumps(clean, ensure_ascii=False, indent=1, sort_keys=True), encoding='utf-8')


def normalize_tags(tags) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for t in tags or []:
        s = str(t).strip()
        if not s or len(s) > 40:
            continue
        if s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
    return out[:20]


class TagsCache:
    """One listing pass touches many folders; read each index once."""

    def __init__(self) -> None:
        self._by_dir: dict[Path, dict] = {}

    def index(self, folder: Path) -> dict:
        if folder not in self._by_dir:
            self._by_dir[folder] = load_tags_index(folder)
        return self._by_dir[folder]

    def tags_of(self, file: Path) -> list[str]:
        return list(self.index(file.parent).get(file.name) or [])

    def all_tags(self) -> list[str]:
        seen: dict[str, str] = {}
        for idx in self._by_dir.values():
            for tags in idx.values():
                for t in tags:
                    seen.setdefault(str(t).lower(), str(t))
        return sorted(seen.values(), key=str.lower)


def set_tags(file: Path, tags) -> list[str]:
    idx = load_tags_index(file.parent)
    clean = normalize_tags(tags)
    if clean:
        idx[file.name] = clean
    else:
        idx.pop(file.name, None)
    save_tags_index(file.parent, idx)
    return clean


def sidecar_paths(file: Path) -> list[Path]:
    """Companion files that must travel with a move."""
    out: list[Path] = []
    name = file.name
    if name.endswith('.layout.json'):
        stem = name[: -len('.layout.json')]
        out.append(file.with_name(stem + '.layout.preview.jpg'))
        out.append(file.with_name(stem + '.variants.json'))
        out.append(file.with_name(stem + '.variants'))
    return [p for p in out if p.exists()]


def move_file(file: Path, dest_dir: Path) -> list[str]:
    """Move a file, its sidecars and its tag entry. Returns the names moved."""
    import shutil

    targets = [file] + sidecar_paths(file)
    for t in targets:
        if (dest_dir / t.name).exists():
            raise ValueError(f'{t.name} esiste già nella destinazione')
    dest_dir.mkdir(parents=True, exist_ok=True)
    for t in targets:
        shutil.move(str(t), str(dest_dir / t.name))

    src_idx = load_tags_index(file.parent)
    tags = src_idx.pop(file.name, None)
    if tags is not None:
        save_tags_index(file.parent, src_idx)
        dest_idx = load_tags_index(dest_dir)
        dest_idx[file.name] = tags
        save_tags_index(dest_dir, dest_idx)
    return [t.name for t in targets]
