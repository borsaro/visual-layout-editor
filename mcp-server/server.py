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
        'and their fields.\n\n'
        'SEVERAL VERSIONS OF ONE AD ARE VARIANTS, NOT SEPARATE FILES. When asked for N '
        'versions, options, alternatives or A/B tests of the same design, build one layout '
        'and call save_variants with one entry per version: they show up in the editor\'s '
        'variants strip, the user browses them side by side, and the base stays the single '
        'source of truth, so a later fix to the base reaches all of them. Copying the '
        '.layout.json N times instead makes N designs that drift apart. Use create_layout '
        'for a genuinely different piece: another format, another screen, another campaign.'
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
async def add_layers(
    path: str,
    layers: list[dict],
    index: int | None = None,
) -> dict:
    """Append layers to a .layout.json on disk. Works with no editor open.

    The counterpart of patch_layout_file, which only reaches layers that already exist.
    Each layer needs at least "type" (text, rect, image, gradient, shape) plus x, y, w, h;
    id and z are filled in when missing (the id comes from the layer's name, so it stays
    readable and stable for later patches).

    index inserts into the stack instead of on top — index=0 puts a background under
    everything already there.

    If that layout is open in the editor, prefer add_live_layers: the user sees it at once.
    """
    payload: dict = {'path': path, 'layers': layers}
    if index is not None:
        payload['index'] = index
    return await _post('/api/add-layers', payload)


@mcp.tool()
async def create_layout(
    path: str,
    width: int,
    height: int,
    background: str = '#ffffff',
    layers: list[dict] | None = None,
    overwrite: bool = False,
) -> dict:
    """Create a new .layout.json from nothing: canvas size, background, optional layers.

    path is where to write it (…/name.layout.json, campaign-relative or ./examples/…).
    This is the tool for a new screen or a new format — writing the JSON by hand is
    what it replaces.

    NOT the tool for another version of the same ad: for that use save_variants, so the
    versions stay one project with one base instead of N files that drift apart.
    """
    return await _post('/api/create-layout', {
        'path': path, 'width': width, 'height': height,
        'background': background, 'layers': layers or [], 'overwrite': overwrite,
    })


@mcp.tool()
async def resize_canvas(
    path: str,
    width: int,
    height: int,
    scale_layers: bool = True,
    out: str | None = None,
) -> dict:
    """Move a layout onto another canvas, carrying its layers along.

    The 1350 -> 1080 pass, done properly: x/w follow the width factor, y/h the height
    factor, while type, radii and effect blurs follow the smaller of the two, which is
    what keeps a rescaled design from looking stretched.

    out writes a new file and leaves the source alone (the usual "same ad, square
    format" move). scale_layers=False changes the canvas only.
    """
    payload: dict = {'path': path, 'width': width, 'height': height, 'scale_layers': scale_layers}
    if out:
        payload['out'] = out
    return await _post('/api/resize-canvas', payload)


@mcp.tool()
async def measure_image(
    path: str,
    mode: str = 'dark',
    threshold: float = 0.22,
    region: bool = True,
) -> dict:
    """Read an image's pixels: its size, and where a region of interest sits in it.

    mode='dark' finds the largest dark blob — a switched-off phone screen in a
    photograph, which is the measurement a mockup needs. 'bright' inverts it, 'alpha'
    uses the transparency of a cutout instead.

    Returns the bounding box, the four corners as a quadrilateral (TL, TR, BR, BL),
    the corner radius in pixels, and a ready-made `warp` block: x/y/w/h plus normalised
    warpPoints to drop straight into a warped image layer. All numbers are in the
    coordinates of the file on disk.

    region=False skips the search and returns size and format only.
    """
    return await _post('/api/measure-image', {
        'path': path, 'mode': mode, 'threshold': threshold, 'region': region,
    })


@mcp.tool()
async def edit_image(
    path: str,
    op: str,
    out: str | None = None,
    x: int | None = None,
    y: int | None = None,
    w: int | None = None,
    h: int | None = None,
    degrees: float | None = None,
) -> dict:
    """Crop, resize, fit, pad or rotate an image file. The source is never modified.

    op='crop' needs x, y, w, h. op='resize' takes w and/or h (the missing one keeps the
    aspect). op='fit' covers a w x h box and centre-crops the overflow — "make this photo
    fill 1080x1350". op='pad' fits inside the box instead, on a transparent ground.
    op='rotate' takes degrees (clockwise) and grows the canvas to keep the corners.

    Without out, the result is written beside the source as <name>-<op>.<ext>. The
    reply carries the new size and an `src` ready to paste into an image layer.
    """
    payload: dict = {'path': path, 'op': op}
    for key, value in (('out', out), ('x', x), ('y', y), ('w', w), ('h', h), ('degrees', degrees)):
        if value is not None:
            payload[key] = value
    return await _post('/api/image-op', payload)


@mcp.tool()
async def measure_text(layers: list[dict]) -> dict:
    """Measure text layers the way the editor will draw them, before rendering anything.

    Pass text layers as they appear in a layout (text, fontFamily, fontSize, fontWeight,
    lineHeight, letterSpacing, w, h). Returns, per layer: the wrapped lines, how many,
    the widest line in px, the total block height, and whether it overflows its box.

    Use it to pick a font size or a box width in one step instead of exporting and
    looking. Fonts are the same ones the export loads, so the numbers match the render.
    """
    return await _post('/api/measure-text', {'layers': layers})


@mcp.tool()
async def render_html(
    html: str,
    width: int = 1080,
    height: int | None = None,
    scale: float = 1.0,
    transparent: bool = False,
    out: str | None = None,
) -> dict:
    """Rasterise arbitrary HTML to PNG with the same Chromium the export uses.

    For anything that is easier written as markup than as layers — a feed mockup, a
    chat bubble, a table. height=None shoots the full document height; scale is the
    device pixel ratio (2 for a retina-sharp shot); transparent drops the background.

    out writes the PNG and returns its path, otherwise the PNG comes back as base64.
    """
    payload: dict = {'html': html, 'width': width, 'scale': scale, 'transparent': transparent}
    if height:
        payload['height'] = height
    if out:
        payload['out'] = out
    return await _post('/api/render-html', payload)


@mcp.tool()
async def export_png_batch(items: list, timeout: float | None = None) -> dict:
    """Export many layouts in one call, sharing a single browser.

    items is a list of paths, or of {"path": …, "out": …} when the destination matters.
    Without out, each PNG lands in exports/ beside its layout. Fourteen exports used to
    be fourteen Chromium launches; this is one.
    """
    # A batch is as slow as the sum of its renders: the global timeout is for single calls.
    limit = float(timeout or os.environ.get('ROBY_EXPORT_BATCH_TIMEOUT', '600'))
    async with httpx.AsyncClient(timeout=limit) as client:
        res = await client.post(f'{EDITOR_URL}/api/export-batch', json={'items': items})
        try:
            return res.json()
        except json.JSONDecodeError:
            return {'ok': False, 'error': f'HTTP {res.status_code}: {res.text[:200]}'}


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

    THE tool for "make me N versions of this ad": one entry per version, all sharing the
    base. Order matters — the list order is the order of the strip and of the exports.

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


@mcp.tool()
async def remove_background(
    path: str,
    model: str | None = None,
    out: str | None = None,
    layout: str | None = None,
    layer_id: str | None = None,
    alpha_matting: bool = True,
    decontaminate: float = 0.8,
    feather: float = 0.0,
) -> dict:
    """Cut the subject out of an image; writes <name>-cutout.png beside the source.

    The original file is never touched. The mask is upscaled back to the source
    resolution and the old background's colour is bled out of the soft edge, so the
    cutout composites cleanly on any new background.

    model: birefnet-general (default, best all-round), birefnet-portrait (people and
    hair), birefnet-general-lite (much faster, slightly coarser edges). Weights
    download on first use (927/927/213 MB) into a mounted volume, so expect the very
    first call per model to take minutes; after that, seconds.

    Pass layout + layer_id to also repoint that layer's src at the cutout in the same
    call. Inference is CPU-bound: on large images a call can take tens of seconds.
    """
    payload: dict = {
        'path': path,
        'alpha_matting': alpha_matting,
        'decontaminate': decontaminate,
        'feather': feather,
    }
    if model:
        payload['model'] = model
    if out:
        payload['out'] = out
    if layout and layer_id:
        payload.update(layout=layout, layer_id=layer_id)
    # First use downloads up to ~1 GB of weights and CPU inference is slow: the
    # global 30 s timeout would kill exactly the calls this tool exists for.
    timeout = float(os.environ.get('ROBY_BG_TIMEOUT', '900'))
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(f'{EDITOR_URL}/api/remove-background', json=payload)
        try:
            return res.json()
        except json.JSONDecodeError:
            return {'ok': False, 'error': f'HTTP {res.status_code}: {res.text[:200]}'}


@mcp.tool()
async def list_bg_models() -> dict:
    """Background-removal models: id, size, what each is best at, downloaded or not."""
    return await _post('/api/bg-models', {})


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
