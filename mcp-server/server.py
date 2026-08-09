"""MCP server exposing the Roby Visual Layout Editor to agents.

Live tools act on the editor open in the browser and are visible immediately.
File tools act on .layout.json on disk and work with no editor running.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

EDITOR_URL = os.environ.get('ROBY_EDITOR_URL', 'http://127.0.0.1:8765').rstrip('/')
TIMEOUT = float(os.environ.get('ROBY_EDITOR_TIMEOUT', '30'))

mcp = MCPServer(
    name='roby-visual-layout-editor',
    instructions=(
        'Design tools for the Roby Visual Layout Editor. Prefer the live tools when an editor '
        'is open: the user sees each change immediately and can undo it. Always pass path '
        '(the open .layout.json) on live tools so you only touch that design; other open '
        'editors stay isolated. Call get_live_state() first; if several sessions are listed, '
        'pick one by path or client. Call get_capabilities() once to learn the layer types '
        'and their fields.'
    ),
)


def _live_target(path: str | None, client: str | None) -> dict:
    out: dict = {}
    if path:
        out['path'] = path
    if client:
        out['client'] = client
    return out


async def _get(path: str, params: dict | None = None) -> Any:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await client.get(f'{EDITOR_URL}{path}', params=params)
        res.raise_for_status()
        return res.json()


async def _post(path: str, payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await client.post(f'{EDITOR_URL}{path}', json=payload)
        try:
            return res.json()
        except json.JSONDecodeError:
            return {'ok': False, 'error': f'HTTP {res.status_code}: {res.text[:200]}'}


@mcp.tool()
async def get_capabilities() -> dict:
    """Editor capabilities: endpoints, layer types, per-type fields and agent recipes.

    Call this first when unsure which fields or layer types exist.
    """
    return await _get('/api/health')


@mcp.tool()
async def get_live_state(
    path: str | None = None,
    client: str | None = None,
    include_layers: bool = True,
) -> dict:
    """Read the layout open in an editor, as shown on screen.

    Pass path (preferred) or client when more than one editor is open. Without a filter,
    a single open editor is returned; multiple editors return sessions[] and ask you to pick.
    connected=False when nobody is open: use the file tools then.
    """
    data = await _get('/api/live/state', _live_target(path, client) or None)
    state = data.get('state')
    if state and not include_layers:
        n = len(state.get('layers') or [])
        state = {**state, 'layers': f'{n} layers (omitted)'}
        data = {**data, 'state': state}
    return data


@mcp.tool()
async def patch_live_layers(
    patches: list[dict],
    path: str | None = None,
    client: str | None = None,
    autosave: bool = True,
) -> dict:
    """Change layers in the open editor. The user sees it instantly and can undo with Cmd+Z.

    Pass path to target only that design (required when several editors are open).
    Each patch targets one layer by "id" (preferred) or unique "name", plus the fields to set.
    Example: [{"id": "title", "skewX": -12, "color": "#ffffff"}]
    Use get_capabilities() for the valid fields of each layer type.
    """
    return await _post('/api/live/patch', {
        'patches': patches, 'autosave': autosave, **_live_target(path, client),
    })


@mcp.tool()
async def add_live_layers(
    layers: list[dict],
    path: str | None = None,
    client: str | None = None,
    autosave: bool = True,
) -> dict:
    """Append new layers to the open editor.

    Pass path to target only that design (required when several editors are open).
    Each layer needs at least "type" (text, rect, image, gradient, shape) plus x, y, w, h.
    Missing id and z are filled in automatically.
    Example: [{"type": "shape", "shapeKind": "hexagon", "x": 100, "y": 100, "w": 300, "h": 300,
               "fill": "#eb0029", "corner": 16}]
    """
    return await _post('/api/live/patch', {
        'add': layers, 'autosave': autosave, **_live_target(path, client),
    })


@mcp.tool()
async def remove_live_layers(
    layer_ids: list[str],
    path: str | None = None,
    client: str | None = None,
    autosave: bool = True,
) -> dict:
    """Delete layers from the open editor by id. Reversible by the user with Cmd+Z.

    Pass path to target only that design (required when several editors are open).
    """
    return await _post('/api/live/patch', {
        'remove': layer_ids, 'autosave': autosave, **_live_target(path, client),
    })


@mcp.tool()
async def list_layouts(folder: str = '') -> dict:
    """List campaign folders and .layout.json files under the campaigns root."""
    return await _get('/api/list-layouts', {'folder': folder, 'light': '1'})


@mcp.tool()
async def load_layout(path: str) -> dict:
    """Read a .layout.json from disk without opening it in the editor."""
    return await _get('/api/load-layout', {'path': path})


@mcp.tool()
async def patch_layout_file(path: str, patches: list[dict], return_layout: bool = False) -> dict:
    """Patch layers directly in a .layout.json on disk. Works with no editor open.

    If that layout is currently open in the editor, the user must press reload to see it;
    prefer patch_live_layers in that case.
    """
    return await _post('/api/patch-layers', {
        'path': path,
        'patches': patches,
        'return_layout': return_layout,
    })


@mcp.tool()
async def export_png(path: str, out: str | None = None) -> dict:
    """Render a layout to PNG server-side via Playwright.

    Pass out to write the file, otherwise the PNG is returned as base64.
    """
    payload: dict = {'path': path}
    if out:
        payload['out'] = out
    else:
        payload['return_base64'] = True
    return await _post('/api/export', payload)


@mcp.tool()
async def list_variants(path: str) -> dict:
    """Read the variant set of a layout: alternative versions shown in the editor's bar.

    Each variant carries `stale` and `missingLayers`: true when the base layout has
    changed so that the variant now targets layers that no longer exist.
    """
    return await _get('/api/variants', {'path': path})


@mcp.tool()
async def save_variants(
    path: str,
    variants: list[dict],
    replace: bool = True,
    thumbnails: bool = True,
) -> dict:
    """Save alternative versions of one layout, browsable from the editor's variants bar.

    A variant is NOT a copy of the layout: it is the ops to apply on top of it, in the
    same shape patch_live_layers already uses. Ten variants cost a couple of KB and the
    base stays the single source of truth.

        variants=[{
          "id": "v01",                      # letters, digits, . _ - only
          "label": "Headline più diretta",  # shown under the thumbnail
          "axes": ["text", "color"],        # free tags: what this variant changes
          "ops": {
            "patches": [{"id": "title", "text": "…", "color": "#fff"}],
            "add":     [{"id": "badge", "type": "rect", …}],   # optional
            "remove":  ["old_layer_id"]                        # optional
          }
        }]

    Any patchable layer field is fair game (see get_capabilities): copy, colors, image
    src, position, warp. Combine several in one variant to vary more than one axis.

    replace=False merges into the existing set by id instead of overwriting it.
    thumbnails=False skips rendering, which is much faster while iterating on the ops.
    """
    return await _post('/api/variants', {
        'path': path,
        'variants': variants,
        'replace': replace,
        'thumbnails': thumbnails,
    })


@mcp.tool()
async def promote_variant(path: str, variant_id: str, filename: str | None = None) -> dict:
    """Bake one variant into its own standalone .layout.json next to the base.

    Use when a variant is picked as a keeper. The variant stays in the set, marked with
    the file it produced, so the link back to where it came from survives.
    """
    payload: dict = {'path': path, 'id': variant_id}
    if filename:
        payload['filename'] = filename
    return await _post('/api/variants/promote', payload)


@mcp.tool()
async def delete_variants(path: str, variant_ids: list[str]) -> dict:
    """Drop variants (and their thumbnails) from a layout's set."""
    return await _post('/api/variants/delete', {'path': path, 'ids': variant_ids})


def _transport_security() -> TransportSecuritySettings | None:
    """Host allowlist for the HTTP transport.

    Empty or '*' disables DNS rebinding protection, needed when the container is reached
    through an arbitrary LAN hostname. Same exposure as the editor itself, which already
    listens on 0.0.0.0 without auth.
    """
    raw = os.environ.get('ROBY_MCP_ALLOWED_HOSTS', '*').strip()
    if not raw or raw == '*':
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)
    hosts = [h.strip() for h in raw.split(',') if h.strip()]
    return TransportSecuritySettings(allowed_hosts=hosts, allowed_origins=hosts)


if __name__ == '__main__':
    transport = os.environ.get('ROBY_MCP_TRANSPORT', 'stdio')
    if transport == 'stdio':
        mcp.run()
    else:
        mcp.run(
            transport=transport,
            host=os.environ.get('ROBY_MCP_HOST', '127.0.0.1'),
            port=int(os.environ.get('ROBY_MCP_PORT', '8766')),
            transport_security=_transport_security(),
        )
