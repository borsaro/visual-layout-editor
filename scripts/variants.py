"""Ad variants: alternative versions of one layout, stored as ops over a base.

A variant is not a copy of the layout. It is the same {patches, add, remove}
trittico the live channel and patch_layers already speak, so an agent emits the
vocabulary it already knows and ten variants cost a couple of KB instead of ten
full layouts. The base stays the single source of truth: fix the logo once and
every variant inherits the fix.

Layout on disk, following the existing preview-sidecar convention:

    ad.layout.json            base, untouched
    ad.layout.preview.jpg     base thumbnail (pre-existing)
    ad.variants.json          this file's payload
    ad.variants/v03.jpg       one thumbnail per variant
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from patch_layers import apply_patches

VARIANT_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
MAX_VARIANTS = 200


def variants_path(layout_path: Path) -> Path:
    name = layout_path.name
    stem = name[: -len('.layout.json')] if name.endswith('.layout.json') else name
    return layout_path.with_name(stem + '.variants.json')


def variants_thumb_dir(layout_path: Path) -> Path:
    name = layout_path.name
    stem = name[: -len('.layout.json')] if name.endswith('.layout.json') else name
    return layout_path.with_name(stem + '.variants')


def variant_thumb_path(layout_path: Path, variant_id: str) -> Path:
    return variants_thumb_dir(layout_path) / f'{safe_variant_id(variant_id)}.jpg'


def safe_variant_id(variant_id: Any) -> str:
    vid = str(variant_id or '').strip()
    if not VARIANT_ID_RE.match(vid):
        raise ValueError(f'Invalid variant id {variant_id!r}: use letters, digits, . _ -')
    return vid


def base_fingerprint(layout: dict) -> str:
    """Identity of the layer set a variant was authored against.

    Only ids and types: moving a layer or retyping the copy must not invalidate
    variants, but deleting or replacing a layer they target must.
    """
    layers = layout.get('layers') or []
    seed = '|'.join(f"{l.get('id')}:{l.get('type')}" for l in layers if isinstance(l, dict))
    return hashlib.sha256(seed.encode('utf-8')).hexdigest()[:16]


def _validated_ops(ops: Any, index: int) -> dict:
    if not isinstance(ops, dict):
        raise ValueError(f'variants[{index}].ops must be an object')
    patches = ops.get('patches') or []
    add = ops.get('add') or []
    remove = ops.get('remove') or []
    for key, value in (('patches', patches), ('add', add), ('remove', remove)):
        if not isinstance(value, list):
            raise ValueError(f'variants[{index}].ops.{key} must be a list')
    # Empty ops are legitimate: the editor creates a variant as a plain duplicate of
    # the base, which the user then edits. Rejecting it would block that flow.
    for i, patch in enumerate(patches):
        if not isinstance(patch, dict):
            raise ValueError(f'variants[{index}].ops.patches[{i}] must be an object')
        if not patch.get('id') and not patch.get('name'):
            raise ValueError(f'variants[{index}].ops.patches[{i}] needs id or name')
    for i, layer in enumerate(add):
        if not isinstance(layer, dict) or not layer.get('type'):
            raise ValueError(f'variants[{index}].ops.add[{i}] must be a layer object with a type')
    return {
        'patches': patches,
        'add': add,
        'remove': [str(x) for x in remove if x],
    }


def validate_variants(variants: Any) -> list[dict]:
    if not isinstance(variants, list) or not variants:
        raise ValueError('variants must be a non-empty list')
    if len(variants) > MAX_VARIANTS:
        raise ValueError(f'Too many variants ({len(variants)}); max {MAX_VARIANTS}')
    seen: set[str] = set()
    out = []
    for i, raw in enumerate(variants):
        if not isinstance(raw, dict):
            raise ValueError(f'variants[{i}] must be an object')
        vid = safe_variant_id(raw.get('id') or f'v{i + 1:02d}')
        if vid in seen:
            raise ValueError(f'Duplicate variant id {vid!r}')
        seen.add(vid)
        axes = raw.get('axes') or []
        if not isinstance(axes, list):
            raise ValueError(f'variants[{i}].axes must be a list')
        out.append({
            'id': vid,
            'label': str(raw.get('label') or vid),
            'note': str(raw.get('note') or ''),
            'axes': [str(a) for a in axes],
            'ops': _validated_ops(raw.get('ops'), i),
            'promoted': raw.get('promoted') or None,
            # Which variant this one was duplicated from (None = the base). Kept so the
            # strip can show the parent's picture until the copy has one of its own.
            'from': safe_variant_id(raw['from']) if raw.get('from') else None,
        })
    return out


def apply_variant(layout: dict, variant: dict) -> dict:
    """Base + ops -> a full layout. The base dict is never mutated."""
    out = json.loads(json.dumps(layout))
    layers = out.setdefault('layers', [])
    ops = variant.get('ops') or {}

    remove = set(ops.get('remove') or [])
    if remove:
        out['layers'] = [l for l in layers if l.get('id') not in remove]
        layers = out['layers']

    patches = ops.get('patches') or []
    if patches:
        apply_patches(out, patches)

    for layer in ops.get('add') or []:
        clone = json.loads(json.dumps(layer))
        # An add that reuses an existing id would shadow it; treat it as a replace.
        out['layers'] = [l for l in out['layers'] if l.get('id') != clone.get('id')]
        out['layers'].append(clone)
    return out


def read_variants(layout_path: Path) -> dict:
    path = variants_path(layout_path)
    if not path.exists():
        return {'base': layout_path.name, 'baseFingerprint': None, 'variants': []}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        raise ValueError(f'{path.name} is not valid JSON: {e}') from e
    if not isinstance(data, dict):
        raise ValueError(f'{path.name} must contain an object')
    data.setdefault('base', layout_path.name)
    data.setdefault('baseFingerprint', None)
    data.setdefault('variants', [])
    return data


def write_variants(layout_path: Path, layout: dict, variants: list[dict], replace: bool = True) -> dict:
    """Persist the set. replace=False merges by id, so a second batch appends."""
    validated = validate_variants(variants)
    if replace:
        merged = validated
    else:
        existing = read_variants(layout_path).get('variants') or []
        by_id = {v.get('id'): v for v in existing if isinstance(v, dict)}
        for v in validated:
            by_id[v['id']] = v
        merged = list(by_id.values())
        if len(merged) > MAX_VARIANTS:
            raise ValueError(f'Too many variants ({len(merged)}); max {MAX_VARIANTS}')

    payload = {
        'version': 1,
        'base': layout_path.name,
        'baseFingerprint': base_fingerprint(layout),
        'variants': merged,
    }
    path = variants_path(layout_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename: a crash mid-write must not leave a truncated set behind.
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)
    return payload


def annotate_staleness(payload: dict, layout: dict) -> dict:
    """Flag variants authored against a different layer set, and say which ids broke."""
    current = {l.get('id') for l in (layout.get('layers') or []) if isinstance(l, dict)}
    fingerprint = base_fingerprint(layout)
    stored = payload.get('baseFingerprint')
    payload['baseFingerprint'] = stored
    payload['baseChanged'] = bool(stored) and stored != fingerprint
    payload['currentFingerprint'] = fingerprint
    for variant in payload.get('variants') or []:
        ops = variant.get('ops') or {}
        targeted = {p.get('id') for p in (ops.get('patches') or []) if p.get('id')}
        targeted |= {str(x) for x in (ops.get('remove') or [])}
        missing = sorted(t for t in targeted if t and t not in current)
        variant['missingLayers'] = missing
        variant['stale'] = bool(missing)
    return payload


def diff_layers_to_ops(base_layers: list, other_layers: list) -> dict:
    """other = base + ops. The inverse of apply_variant, restricted to writable fields.

    Only fields a patch may carry are compared, so the ops produced here can never
    describe a difference that applying them would silently drop.
    """
    from patch_layers import ALLOWED_PATCH_KEYS
    base = {l.get('id'): l for l in base_layers or [] if isinstance(l, dict)}
    other = {l.get('id'): l for l in other_layers or [] if isinstance(l, dict)}
    patches = []
    for lid, layer in other.items():
        before = base.get(lid)
        if before is None:
            continue
        patch = {}
        for key in set(list(before) + list(layer)):
            if key in ('id', 'type') or key not in ALLOWED_PATCH_KEYS:
                continue
            if json.dumps(before.get(key), sort_keys=True) != json.dumps(layer.get(key), sort_keys=True):
                patch[key] = layer.get(key)
        if patch:
            patches.append({'id': lid, **patch})
    return {
        'patches': patches,
        'add': [json.loads(json.dumps(l)) for lid, l in other.items() if lid not in base],
        'remove': [lid for lid in base if lid not in other],
    }


def make_variant_base(layout_path: Path, layout: dict, variant_id: str,
                      keep_old_base: bool = True, old_base_label: str | None = None) -> dict:
    """Swap a variant with the base: it becomes the layout, the layout becomes a variant.

    Every other variant is rewritten against the new base — their ops describe a
    difference from whatever the base is, so leaving them alone would silently change
    what they render.
    """
    vid = safe_variant_id(variant_id)
    payload = read_variants(layout_path)
    variants = payload.get('variants') or []
    chosen = next((v for v in variants if v.get('id') == vid), None)
    if not chosen:
        raise ValueError(f'Variant {vid!r} not found')

    new_base = apply_variant(layout, chosen)
    rebuilt = []
    if keep_old_base:
        old_ops = diff_layers_to_ops(new_base.get('layers') or [], layout.get('layers') or [])
        taken = {v.get('id') for v in variants}
        old_id = safe_variant_id('base-precedente')
        i = 2
        while old_id in taken:
            old_id = safe_variant_id(f'base-precedente-{i}')
            i += 1
        rebuilt.append({
            'id': old_id,
            'label': old_base_label or 'Base precedente',
            'note': f'Era il layout base prima che {chosen.get("label") or vid} lo diventasse',
            'axes': ['base'],
            'ops': old_ops,
            'promoted': None,
            'from': None,
        })
    for v in variants:
        if v.get('id') == vid:
            continue                      # it is the base now
        baked = apply_variant(layout, v)
        rebuilt.append({**v, 'ops': diff_layers_to_ops(new_base.get('layers') or [], baked.get('layers') or [])})

    layout_path.write_text(json.dumps(new_base, ensure_ascii=False, indent=2), encoding='utf-8')
    if rebuilt:
        write_variants(layout_path, new_base, rebuilt, replace=True)
    else:
        vp = variants_path(layout_path)
        if vp.exists():
            vp.unlink()
    thumb = variant_thumb_path(layout_path, vid)
    if thumb.exists():
        thumb.unlink()                    # the promoted one is no longer a variant
    return {'path': str(layout_path), 'promoted': vid, 'layout': new_base,
            'variants': rebuilt, 'old_base_id': rebuilt[0]['id'] if keep_old_base and rebuilt else None}


def promote_variant(layout_path: Path, layout: dict, variant_id: str, filename: str | None = None) -> dict:
    """Bake one variant into a standalone .layout.json next to the base."""
    vid = safe_variant_id(variant_id)
    payload = read_variants(layout_path)
    variant = next((v for v in payload.get('variants') or [] if v.get('id') == vid), None)
    if not variant:
        raise ValueError(f'Variant {vid!r} not found')

    baked = apply_variant(layout, variant)
    stem = layout_path.name[: -len('.layout.json')] if layout_path.name.endswith('.layout.json') else layout_path.stem
    name = filename or f'{stem}-{vid}.layout.json'
    if not name.endswith('.layout.json'):
        name += '.layout.json'
    if '/' in name or '\\' in name:
        raise ValueError('filename must not contain a path')
    out_path = layout_path.with_name(name)
    if out_path.exists():
        raise ValueError(f'{name} already exists')
    out_path.write_text(json.dumps(baked, ensure_ascii=False, indent=2), encoding='utf-8')

    # Extracting takes the variant OUT of the project: leaving a copy behind would mean
    # two places to edit the same design, and nothing to say which one is current.
    kept = [v for v in (payload.get('variants') or []) if v.get('id') != vid]
    if kept:
        write_variants(layout_path, layout, kept, replace=True)
    else:
        vp = variants_path(layout_path)
        if vp.exists():
            vp.unlink()
    thumb = variant_thumb_path(layout_path, vid)
    if thumb.exists():
        thumb.unlink()
    return {'path': str(out_path), 'filename': name, 'layout': baked, 'removed': vid,
            'remaining': len(kept)}
