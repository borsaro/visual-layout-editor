"""Validate live patch payloads and encode SSE frames."""
from __future__ import annotations

import json

HEARTBEAT_SECONDS = 20

ERR_NO_EDITOR = (
    'No editor connected. Open the editor, or use /api/patch-layers to edit the file directly.'
)
ERR_MULTI = 'Multiple editors open. Pass path or client to target one design.'
ERR_NO_MATCH = (
    'No editor has that layout open. Pass a connected path/client, or use /api/patch-layers.'
)


def sse_frame(event: str, data: dict) -> bytes:
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode('utf-8')


def sse_heartbeat() -> bytes:
    return b': ping\n\n'


def _validated_patches(patches) -> list[dict]:
    out = []
    for i, patch in enumerate(patches):
        if not isinstance(patch, dict):
            raise ValueError(f'patches[{i}] must be an object')
        if not patch.get('id') and not patch.get('name'):
            raise ValueError(f'patches[{i}] needs id or name to target a layer')
        out.append(patch)
    return out


def _validated_layers(layers) -> list[dict]:
    out = []
    for i, layer in enumerate(layers):
        if not isinstance(layer, dict):
            raise ValueError(f'add[{i}] must be a layer object')
        if not layer.get('type'):
            raise ValueError(f'add[{i}] needs a type (text, rect, image, gradient, shape)')
        out.append(layer)
    return out


def build_live_ops(payload: dict) -> dict:
    """One live message can patch, add and remove layers; at least one must be present."""
    patches = _validated_patches(payload.get('patches') or [])
    add = _validated_layers(payload.get('add') or [])
    remove = [str(x) for x in (payload.get('remove') or []) if x]
    if not patches and not add and not remove:
        raise ValueError('Nothing to do: provide patches[], add[] or remove[]')
    return {'patches': patches, 'add': add, 'remove': remove}
