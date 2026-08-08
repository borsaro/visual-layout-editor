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
        'is open: the user sees each change immediately and can undo it. Call get_capabilities() '
        'once to learn the layer types and their fields.'
    ),
)


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
async def get_live_state(include_layers: bool = True) -> dict:
    """Read the layout currently open in the editor, as shown on screen.

    Returns connected=False when no editor is open; use the file tools then.
    """
    data = await _get('/api/live/state')
    state = data.get('state')
    if state and not include_layers:
        state = {**state, 'layers': f"{len(state.get('layers') or [])} layers (omitted)"}
        data = {**data, 'state': state}
    return data


@mcp.tool()
async def patch_live_layers(patches: list[dict], autosave: bool = True) -> dict:
    """Change layers in the open editor. The user sees it instantly and can undo with Cmd+Z.

    Each patch targets one layer by "id" (preferred) or unique "name", plus the fields to set.
    Example: [{"id": "title", "skewX": -12, "color": "#ffffff"}]
    Use get_capabilities() for the valid fields of each layer type.
    """
    return await _post('/api/live/patch', {'patches': patches, 'autosave': autosave})


@mcp.tool()
async def add_live_layers(layers: list[dict], autosave: bool = True) -> dict:
    """Append new layers to the open editor.

    Each layer needs at least "type" (text, rect, image, gradient, shape) plus x, y, w, h.
    Missing id and z are filled in automatically.
    Example: [{"type": "shape", "shapeKind": "hexagon", "x": 100, "y": 100, "w": 300, "h": 300,
               "fill": "#eb0029", "corner": 16}]
    """
    return await _post('/api/live/patch', {'add': layers, 'autosave': autosave})


@mcp.tool()
async def remove_live_layers(layer_ids: list[str], autosave: bool = True) -> dict:
    """Delete layers from the open editor by id. Reversible by the user with Cmd+Z."""
    return await _post('/api/live/patch', {'remove': layer_ids, 'autosave': autosave})


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
