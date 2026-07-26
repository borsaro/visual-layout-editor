"""Sidecar preview helpers for layout library thumbnails."""
from __future__ import annotations

from pathlib import Path


def preview_sidecar_path(layout_path: Path) -> Path:
    name = layout_path.name
    if name.endswith('.layout.json'):
        return layout_path.with_name(name[: -len('.layout.json')] + '.layout.preview.jpg')
    return layout_path.with_name(name + '.preview.jpg')


def preview_url_for(layout_path: Path, public_path_fn) -> str | None:
    side = preview_sidecar_path(layout_path)
    if not side.exists():
        return None
    return '/api/layout-preview?path=' + public_path_fn(layout_path)
