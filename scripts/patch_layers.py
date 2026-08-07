"""Patch individual layer fields in a layout JSON (agent / LLM friendly)."""
from __future__ import annotations

from typing import Any


ALLOWED_PATCH_KEYS = {
    'locked', 'visible', 'name', 'x', 'y', 'w', 'h', 'z', 'opacity', 'rotation',
    'skewX', 'skewY',
    'blendMode', 'src', 'fit', 'text', 'fontSize', 'fontWeight', 'fontFamily',
    'fontStyle', 'color', 'align', 'vAlign', 'lineHeight', 'letterSpacing',
    'textTransform', 'fill', 'stroke', 'strokeWidth', 'radius',
    'shadow', 'glow', 'keyBlack', 'adjust', 'gradientType', 'angle', 'stops',
}


def find_layer(layers: list[dict], patch: dict) -> dict | None:
    lid = patch.get('id')
    if lid:
        for layer in layers:
            if layer.get('id') == lid:
                return layer
    name = patch.get('name')
    if name:
        matches = [l for l in layers if l.get('name') == name]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f'Multiple layers named {name!r}; use id')
    return None


def apply_patches(layout: dict[str, Any], patches: list[dict]) -> dict[str, Any]:
    if not isinstance(patches, list) or not patches:
        raise ValueError('patches must be a non-empty list')
    layers = layout.get('layers')
    if not isinstance(layers, list):
        raise ValueError('layout.layers missing')

    updated = []
    for i, patch in enumerate(patches):
        if not isinstance(patch, dict):
            raise ValueError(f'patches[{i}] must be an object')
        layer = find_layer(layers, patch)
        if layer is None:
            raise ValueError(f'patches[{i}]: layer not found (need id or unique name)')

        applied = {}
        for key, value in patch.items():
            if key in ('id',):
                continue
            # Allow rename when matching by id: {"id":"…","name":"New"}
            if key == 'name' and not patch.get('id'):
                continue
            if key not in ALLOWED_PATCH_KEYS:
                continue
            layer[key] = value
            applied[key] = value

        if not applied:
            raise ValueError(f'patches[{i}]: no allowed fields to apply')
        updated.append({'id': layer.get('id'), 'name': layer.get('name'), 'applied': applied})

    return {'updated': updated, 'layers': len(layers)}
