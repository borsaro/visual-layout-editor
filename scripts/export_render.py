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
