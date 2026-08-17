"""Whole-layout edits that patching single layers cannot express.

patch_layers only reaches layers that already exist, so every new screen used to be
written as raw JSON by hand, outside the editor's rules. These are the three missing
verbs: create a layout, append layers to one, and move a design to another canvas.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# Fields that carry a length in canvas units, so they must follow a resize.
SCALED_NUMERIC = ('x', 'y', 'w', 'h', 'fontSize', 'strokeWidth', 'radius', 'letterSpacing')
SCALED_EFFECT = ('blur', 'offsetX', 'offsetY', 'spread', 'size')


def _slug(value: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9._-]+', '-', str(value or '').strip()).strip('-')
    return s or 'layer'


def next_layer_id(layers: list[dict], layer: dict) -> str:
    """Stable, readable ids: the layer's name or type, numbered on collision."""
    taken = {str(l.get('id')) for l in layers if l.get('id')}
    base = _slug(layer.get('name') or layer.get('type') or 'layer')
    if base not in taken:
        return base
    for i in range(2, 1000):
        candidate = f'{base}-{i}'
        if candidate not in taken:
            return candidate
    return f'{base}-{len(layers) + 1}'


def next_z(layers: list[dict]) -> int:
    zs = [int(l.get('z') or 0) for l in layers if isinstance(l.get('z'), (int, float))]
    return (max(zs) + 1) if zs else 0


def add_layers(layout: dict, new_layers: list[dict], *, index: int | None = None) -> dict:
    """Append layers, filling in id and z the way the editor would.

    index inserts at a position in the stack instead of on top, for the case where a
    background has to go under everything already there.
    """
    if not isinstance(new_layers, list) or not new_layers:
        raise ValueError('layers[] required')
    layers = layout.setdefault('layers', [])
    added = []
    for raw in new_layers:
        if not isinstance(raw, dict):
            raise ValueError('each layer must be an object')
        if not raw.get('type'):
            raise ValueError('each layer needs a "type" (text, rect, image, gradient, shape)')
        layer = dict(raw)
        if not layer.get('id'):
            layer['id'] = next_layer_id(layers, layer)
        elif any(str(l.get('id')) == str(layer['id']) for l in layers):
            raise ValueError(f'layer id already used: {layer["id"]}')
        if layer.get('z') is None:
            layer['z'] = next_z(layers)
        if index is None:
            layers.append(layer)
        else:
            layers.insert(max(0, min(int(index), len(layers))), layer)
            index += 1
        added.append({'id': layer['id'], 'type': layer['type'], 'z': layer['z']})
    return {'added': added, 'layers': len(layers)}


def create_layout(width: int, height: int, *, background: str = '#ffffff',
                  layers: list[dict] | None = None, name: str | None = None) -> dict:
    w, h = int(width), int(height)
    if w <= 0 or h <= 0 or w > 20000 or h > 20000:
        raise ValueError('width/height must be between 1 and 20000')
    layout = {'canvas': {'width': w, 'height': h, 'background': background}, 'layers': []}
    if name:
        layout['name'] = name
    if layers:
        add_layers(layout, layers)
    return layout


def _scale_effect(effect, fx: float, fy: float, fmin: float):
    if not isinstance(effect, dict):
        return effect
    out = dict(effect)
    for key in SCALED_EFFECT:
        if isinstance(out.get(key), (int, float)):
            factor = fx if key == 'offsetX' else fy if key == 'offsetY' else fmin
            out[key] = round(out[key] * factor, 3)
    return out


def resize_canvas(layout: dict, width: int, height: int, *, scale_layers: bool = True) -> dict:
    """Move a design onto another canvas, carrying the layers with it.

    Non-uniform targets (1350 -> 1080 at the same width) scale x/w by one factor and
    y/h by another, but type and radii follow the smaller of the two: scaling a font
    by the taller axis is what makes a rescaled layout look wrong.
    """
    canvas = layout.get('canvas') or {}
    src_w, src_h = float(canvas.get('width') or 0), float(canvas.get('height') or 0)
    w, h = int(width), int(height)
    if w <= 0 or h <= 0:
        raise ValueError('width/height must be positive')
    layout['canvas'] = {**canvas, 'width': w, 'height': h}
    if not scale_layers or not src_w or not src_h:
        return {'canvas': layout['canvas'], 'scaled': 0, 'factor': None}

    fx, fy = w / src_w, h / src_h
    fmin = min(fx, fy)
    scaled = 0
    for layer in layout.get('layers') or []:
        touched = False
        for key in SCALED_NUMERIC:
            if isinstance(layer.get(key), (int, float)):
                factor = fx if key in ('x', 'w') else fy if key in ('y', 'h') else fmin
                layer[key] = round(layer[key] * factor, 3)
                touched = True
        for key in ('shadow', 'glow'):
            if isinstance(layer.get(key), dict):
                layer[key] = _scale_effect(layer[key], fx, fy, fmin)
                touched = True
        # Shape vertices and warp corners are normalised 0..1 in the layer box, so they
        # ride along untouched; absolute point lists do not.
        pts = layer.get('points')
        if isinstance(pts, list) and pts and isinstance(pts[0], dict) and 'x' in pts[0]:
            if any(abs(float(p.get('x', 0))) > 1.5 or abs(float(p.get('y', 0))) > 1.5 for p in pts):
                layer['points'] = [
                    {**p, 'x': round(float(p.get('x', 0)) * fx, 3), 'y': round(float(p.get('y', 0)) * fy, 3)}
                    for p in pts
                ]
                touched = True
        scaled += 1 if touched else 0
    return {'canvas': layout['canvas'], 'scaled': scaled,
            'factor': {'x': round(fx, 4), 'y': round(fy, 4)}}


def write_layout(path: Path, layout: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
    return path.stat().st_size
