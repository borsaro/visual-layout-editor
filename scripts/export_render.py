"""Headless PNG export via Playwright + export.html (same canvas path as the editor)."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def _in_docker() -> bool:
    return Path('/.dockerenv').exists() or os.environ.get('ROBY_LAYOUT_DOCKER') == '1'


def _chromium_launch_args() -> list[str]:
    args = ['--disable-dev-shm-usage', '--font-render-hinting=none']
    if _in_docker():
        # Required for Chromium inside many container runtimes
        args.extend(['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'])
    return args


def _origin() -> str:
    host = os.environ.get('ROBY_LAYOUT_EDITOR_HOST', '127.0.0.1')
    if host in ('0.0.0.0', ''):
        host = '127.0.0.1'
    port = os.environ.get('ROBY_LAYOUT_EDITOR_PORT', '8765')
    return f'http://{host}:{port}'


def render_layout_png_bytes(layout: dict[str, Any], origin: str | None = None) -> bytes:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError(
            'Playwright non installato. In Docker: rebuild (`docker compose up -d --build`). '
            'In locale: pip install -r requirements.txt && playwright install chromium'
        ) from e

    base = (origin or _origin()).rstrip('/')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_chromium_launch_args())
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 720})
            page.goto(f'{base}/export.html', wait_until='networkidle', timeout=60000)
            page.wait_for_function('() => window.__robyExportReady === true && typeof window.exportLayoutToPngBase64 === "function"', timeout=30000)
            b64 = page.evaluate(
                """async (layout) => {
                    return await window.exportLayoutToPngBase64(layout);
                }""",
                layout,
            )
        finally:
            browser.close()
    if not b64:
        raise RuntimeError('Export returned empty PNG')
    return base64.b64decode(b64)


def render_layout_thumbs(
    layouts: list[dict[str, Any]],
    max_side: int = 320,
    quality: float = 0.72,
    origin: str | None = None,
) -> list[bytes]:
    """JPEG thumbnails for a batch of layouts, one browser for the whole set.

    render_layout_png_bytes launches Chromium per call, which is fine for a single
    export and hopeless for ten variants: the launch dominates, and the bar would
    take ~20s to fill. Reusing one page brings the per-item cost down to the render.
    """
    if not layouts:
        return []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError(
            'Playwright non installato. In Docker: rebuild (`docker compose up -d --build`). '
            'In locale: pip install -r requirements.txt && playwright install chromium'
        ) from e

    base = (origin or _origin()).rstrip('/')
    out: list[bytes] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_chromium_launch_args())
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 720})
            page.goto(f'{base}/export.html', wait_until='networkidle', timeout=60000)
            page.wait_for_function(
                '() => window.__robyExportReady === true '
                '&& typeof window.exportLayoutToThumbBase64 === "function"',
                timeout=30000,
            )
            for layout in layouts:
                b64 = page.evaluate(
                    """async ([layout, maxSide, quality]) => {
                        return await window.exportLayoutToThumbBase64(layout, maxSide, quality);
                    }""",
                    [layout, max_side, quality],
                )
                out.append(base64.b64decode(b64) if b64 else b'')
        finally:
            browser.close()
    return out


def render_layout_file(path: Path, out: Path | None = None) -> Path:
    layout = json.loads(path.read_text(encoding='utf-8'))
    png = render_layout_png_bytes(layout)
    target = out or path.with_suffix('').with_suffix('.png')
    if not str(target).endswith('.png'):
        target = Path(str(target) + '.png')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png)
    return target


def _page(browser, base: str):
    """One export.html page, fonts and helpers loaded, ready to be reused."""
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.goto(f'{base}/export.html', wait_until='networkidle', timeout=60000)
    page.wait_for_function(
        '() => window.__robyExportReady === true && typeof window.exportLayoutToPngBase64 === "function"',
        timeout=30000,
    )
    return page


def render_layouts_png(layouts: list[dict[str, Any]], origin: str | None = None) -> list[bytes]:
    """Full-size PNGs for a batch, one browser for the whole set.

    Fourteen exports used to be fourteen Chromium launches, and the launch is most of
    the cost.
    """
    if not layouts:
        return []
    from playwright.sync_api import sync_playwright
    base = (origin or _origin()).rstrip('/')
    out: list[bytes] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_chromium_launch_args())
        try:
            page = _page(browser, base)
            for layout in layouts:
                b64 = page.evaluate(
                    'async (layout) => await window.exportLayoutToPngBase64(layout)', layout)
                out.append(base64.b64decode(b64) if b64 else b'')
        finally:
            browser.close()
    return out


def render_html_png(html: str, width: int, height: int | None = None,
                    scale: float = 1.0, origin: str | None = None,
                    full_page: bool = True, transparent: bool = False) -> bytes:
    """Rasterise arbitrary HTML with the same Chromium the export already uses.

    height=None shoots the full document height, which is what a feed mockup wants;
    scale is the device pixel ratio, so scale=2 gives a retina-sharp shot.
    """
    from playwright.sync_api import sync_playwright
    base = (origin or _origin()).rstrip('/')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_chromium_launch_args())
        try:
            page = browser.new_page(
                viewport={'width': int(width), 'height': int(height or 800)},
                device_scale_factor=float(scale or 1),
            )
            # Served from the editor's origin so relative /api/file and font URLs resolve.
            page.goto(f'{base}/export.html', wait_until='domcontentloaded', timeout=60000)
            page.set_content(html, wait_until='networkidle', timeout=60000)
            if transparent:
                page.add_style_tag(content='html,body{background:transparent!important}')
            page.wait_for_timeout(120)   # let webfonts settle before the shot
            return page.screenshot(
                type='png',
                full_page=bool(full_page and not height),
                omit_background=bool(transparent),
            )
        finally:
            browser.close()


def measure_texts(layers: list[dict[str, Any]], origin: str | None = None) -> list[dict]:
    """What the editor would draw: wrapped lines, block height, widest line.

    Uses measureTextLayout from the editor itself, in a page with the same fonts
    loaded, so the answer matches the render instead of approximating it.
    """
    if not layers:
        return []
    from playwright.sync_api import sync_playwright
    base = (origin or _origin()).rstrip('/')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_chromium_launch_args())
        try:
            page = _page(browser, base)
            return page.evaluate(
                """async (layers) => {
                    await window.loadHostFonts?.();
                    await window.ensureLayoutCustomFonts?.(layers);
                    return layers.map((layer) => {
                        const m = window.measureTextLayout(layer);
                        const ctx = window.prepareMeasureCtx(layer);
                        const widths = m.lines.map((line) => ctx.measureText(line).width);
                        return {
                            id: layer.id ?? null,
                            lines: m.lines,
                            lineCount: m.lines.length,
                            lineHeightPx: m.lh,
                            widestLine: Math.round(Math.max(0, ...widths) * 10) / 10,
                            totalHeight: Math.round(m.totalH * 10) / 10,
                            overflowsBox: layer.h ? m.totalH > layer.h + 0.5 : null,
                            fitsWidth: layer.w ? Math.max(0, ...widths) <= layer.w + 0.5 : null,
                        };
                    });
                }""",
                layers,
            )
        finally:
            browser.close()
