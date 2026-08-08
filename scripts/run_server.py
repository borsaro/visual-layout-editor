#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
import base64
import json
import mimetypes
import os
import re
import shutil
import socket
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
CAMPAIGNS_ROOT = Path(os.environ.get(
    'ROBY_LAYOUT_CAMPAIGNS_ROOT',
    '/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER'
)).resolve()
FOLDER_ALIASES = {
    'liveoakbbq-napoleon-freestyle-425': 'napoleon-freestyle-425',
}
PORT = int(os.environ.get('ROBY_LAYOUT_EDITOR_PORT', '8765'))
HOST = os.environ.get('ROBY_LAYOUT_EDITOR_HOST', '127.0.0.1')

ALLOWED_ROOTS = [ROOT.resolve(), CAMPAIGNS_ROOT]
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
FONT_EXTS = {'.ttf', '.otf', '.woff', '.woff2', '.ttc'}


def local_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('8.8.8.8', 80))
            ip = sock.getsockname()[0]
            if ip.startswith(('127.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.')):
                return None
            return ip
    except Exception:
        return None


def in_docker() -> bool:
    return Path('/.dockerenv').exists()


def under(child: Path, parent: Path) -> bool:
    child = child.resolve(); parent = parent.resolve()
    return child == parent or parent in child.parents


def resolve_allowed_any(raw: str) -> Path:
    raw = unquote(raw or '').split('?', 1)[0].split('#', 1)[0].replace('\\', '/')
    if raw.startswith('_assets/') or raw == '_assets':
        p = (CAMPAIGNS_ROOT / raw).resolve()
    elif raw.startswith('./') or raw.startswith('examples/') or raw.startswith('/examples/'):
        p = (ROOT / raw.lstrip('/')).resolve()
    elif raw.startswith('/') or (len(raw) > 2 and raw[1] == ':'):
        p = Path(raw).expanduser().resolve()
    else:
        # Campaign-relative path (e.g. "my-campaign/source/hero.png")
        p = (CAMPAIGNS_ROOT / raw).resolve()
    if not any(under(p, r) for r in ALLOWED_ROOTS):
        raise ValueError(f'Path outside allowed roots: {p}')
    return p


def resolve_allowed_layout(raw: str) -> Path:
    p = resolve_allowed_any(raw)
    if not p.name.endswith('.layout.json'):
        raise ValueError('Only .layout.json files are allowed')
    return p


def resolve_allowed_image(raw: str) -> Path:
    p = resolve_allowed_any(raw)
    if p.suffix.lower() not in IMAGE_EXTS:
        raise ValueError('Only jpg/png/webp images are allowed')
    return p


def resolve_allowed_file(raw: str) -> Path:
    """Resolve safe editor assets, including images and brand fonts."""
    p = resolve_allowed_any(raw)
    if p.suffix.lower() not in IMAGE_EXTS | FONT_EXTS:
        raise ValueError('Only image and font files are allowed')
    return p


def public_path(path: Path) -> str:
    path = path.resolve()
    if under(path, ROOT):
        return './' + path.relative_to(ROOT).as_posix()
    if under(path, CAMPAIGNS_ROOT):
        return path.relative_to(CAMPAIGNS_ROOT).as_posix()
    return path.as_posix()


def asset_src_for(path: Path) -> str:
    """Prefer compact campaign-relative src for layout JSON (no base64, no /api wrapper)."""
    return public_path(path)


def rel_scope(path: Path):
    try:
        return path.relative_to(CAMPAIGNS_ROOT).as_posix(), 'campaigns'
    except Exception:
        try:
            return path.relative_to(ROOT).as_posix(), 'editor'
        except Exception:
            return path.name, 'other'


def clean_folder_rel(raw: str) -> str:
    raw = unquote(raw or '').replace('\\', '/').strip().strip('/')
    parts = []
    for part in raw.split('/'):
        part = part.strip()
        if not part or part in ('.', '..'):
            continue
        parts.append(part)
    return '/'.join(parts)


def resolve_campaign_folder(raw: str) -> Path:
    rel = clean_folder_rel(raw)
    if rel in FOLDER_ALIASES:
        rel = FOLDER_ALIASES[rel]
    p = (CAMPAIGNS_ROOT / rel).resolve() if rel else CAMPAIGNS_ROOT
    if not under(p, CAMPAIGNS_ROOT):
        raise ValueError('Folder outside campaigns root')
    if not p.exists():
        # Browser/localStorage recovery: if an old folder name was saved, do not trap the gallery.
        # Fall back to root so the user can see the folders and navigate again.
        p = CAMPAIGNS_ROOT
    if not p.is_dir():
        raise ValueError(f'Not a folder: {rel}')
    return p


def folder_meta(path: Path):
    """Light folder row — no recursive rglob counts (those made root listing very slow)."""
    rel, scope = rel_scope(path)
    st = path.stat()
    return {
        'kind': 'folder',
        'name': path.name,
        'path': rel,
        'rel': rel,
        'scope': scope,
        'layouts': None,
        'images': None,
        'count': None,
        'mtime': int(st.st_mtime),
        'mtime_iso': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime)),
    }


def clean_layout_filename(name: str) -> str:
    name = (name or '').strip()
    name = re.sub(r'[^A-Za-z0-9._ -]+', '-', name)
    name = name.replace(' ', '_')
    if not name:
        name = 'layout-copy.layout.json'
    if not name.endswith('.json'):
        name += '.layout.json'
    if not name.endswith('.layout.json'):
        name = name[:-5] + '.layout.json'
    return name


def image_size(path: Path):
    try:
        with path.open('rb') as f:
            head = f.read(32)
            if head.startswith(b'\x89PNG\r\n\x1a\n'):
                return struct.unpack('>II', head[16:24])
            if head[:3] == b'\xff\xd8\xff':
                f.seek(2)
                while True:
                    marker_start = f.read(1)
                    if not marker_start:
                        break
                    if marker_start != b'\xff':
                        continue
                    marker = f.read(1)
                    while marker == b'\xff':
                        marker = f.read(1)
                    if marker in [b'\xc0', b'\xc1', b'\xc2', b'\xc3', b'\xc5', b'\xc6', b'\xc7', b'\xc9', b'\xca', b'\xcb', b'\xcd', b'\xce', b'\xcf']:
                        f.read(3)
                        h, w = struct.unpack('>HH', f.read(4))
                        return w, h
                    size_bytes = f.read(2)
                    if len(size_bytes) != 2:
                        break
                    size = struct.unpack('>H', size_bytes)[0]
                    f.seek(size - 2, 1)
            if head.startswith(b'RIFF') and head[8:12] == b'WEBP':
                # Minimal VP8X support
                f.seek(12)
                while True:
                    chunk = f.read(8)
                    if len(chunk) < 8:
                        break
                    ctype, clen = chunk[:4], struct.unpack('<I', chunk[4:])[0]
                    data = f.read(clen)
                    if ctype == b'VP8X' and len(data) >= 10:
                        w = 1 + int.from_bytes(data[4:7], 'little')
                        h = 1 + int.from_bytes(data[7:10], 'little')
                        return w, h
                    if clen % 2:
                        f.read(1)
    except Exception:
        pass
    return 1080, 1350


def layout_meta(path: Path, light: bool = True):
    from library_preview import preview_url_for
    st = path.stat()
    rel, scope = rel_scope(path)
    w = h = None
    layer_count = None
    if not light:
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            canvas = data.get('canvas') or {}
            layers = data.get('layers') or []
            w = canvas.get('width'); h = canvas.get('height')
            layer_count = len(layers)
        except Exception:
            pass
    return {
        'kind': 'layout',
        'name': path.name,
        'path': public_path(path),
        'rel': rel,
        'scope': scope,
        'bytes': st.st_size,
        'mtime': int(st.st_mtime),
        'mtime_iso': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime)),
        'canvas': {'width': w, 'height': h},
        'layers': layer_count,
        'preview_src': preview_url_for(path, public_path),
    }


def image_meta(path: Path, light: bool = True):
    st = path.stat(); rel, scope = rel_scope(path)
    lp = path.with_name(path.stem + '.layout.json')
    w = h = None
    if not light:
        w, h = image_size(path)
    return {
        'kind': 'image',
        'name': path.name,
        'path': public_path(path),
        'rel': rel,
        'scope': scope,
        'bytes': st.st_size,
        'mtime': int(st.st_mtime),
        'mtime_iso': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime)),
        'canvas': {'width': w, 'height': h},
        'layers': 1,
        'has_layout': lp.exists(),
        'layout_path': public_path(lp) if lp.exists() else None,
        'preview_src': '/api/file?path=' + public_path(path),
        'asset_src': asset_src_for(path),
    }


def delete_library_target(kind: str, raw: str):
    """Delete a layout, image, or campaign folder under CAMPAIGNS_ROOT."""
    kind = (kind or '').strip().lower()
    if kind == 'folder':
        rel = clean_folder_rel(raw)
        if not rel:
            raise ValueError('Cannot delete campaigns root')
        folder = resolve_campaign_folder(rel)
        if folder.resolve() == CAMPAIGNS_ROOT.resolve():
            raise ValueError('Cannot delete campaigns root')
        if not under(folder, CAMPAIGNS_ROOT):
            raise ValueError('Folder outside campaigns root')
        if not folder.is_dir():
            raise ValueError(f'Not a folder: {rel}')
        shutil.rmtree(folder)
        return {'kind': 'folder', 'deleted': rel}
    if kind == 'layout':
        from library_preview import preview_sidecar_path
        target = resolve_allowed_layout(raw)
        side = preview_sidecar_path(target)
        target.unlink()
        if side.exists():
            try:
                side.unlink()
            except Exception:
                pass
        return {'kind': 'layout', 'deleted': public_path(target)}
    if kind == 'image':
        target = resolve_allowed_image(raw)
        target.unlink()
        return {'kind': 'image', 'deleted': public_path(target)}
    raise ValueError(f'Unsupported delete kind: {kind}')


def make_layout_from_image(path: Path):
    w, h = image_size(path)
    src = asset_src_for(path)
    return {
        'version': 1,
        'app': 'roby-visual-layout-editor',
        'source_image': src,
        'canvas': {'width': w, 'height': h, 'background': '#ffffff'},
        'layers': [{
            'id': 'layer_background_image',
            'type': 'image',
            'name': path.name,
            'x': 0, 'y': 0, 'w': w, 'h': h,
            'z': 1,
            'opacity': 1,
            'src': src,
            'fit': 'cover',
        }]
    }


class RobyLayoutHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Local editor assets change often; avoid sticky browser cache of JS/CSS.
        if not getattr(self, '_allow_cache', False):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/api/health':
                from api_catalog import check_export_ready, health_payload
                export_ready, export_error = check_export_ready()
                self._json(200, health_payload(
                    campaigns_root=str(CAMPAIGNS_ROOT),
                    editor_root=str(ROOT),
                    export_ready=export_ready,
                    export_error=export_error,
                ))
                return
            if parsed.path == '/api/list-layouts':
                q = parse_qs(parsed.query)
                include_images = q.get('include_images', ['1'])[0] != '0'
                phase = (q.get('phase') or ['all'])[0]
                light = (q.get('light') or ['1'])[0] != '0'
                folder_rel = clean_folder_rel((q.get('folder') or [''])[0])
                folder = resolve_campaign_folder(folder_rel)
                folders = []
                items = []
                if phase in ('folders', 'all') and CAMPAIGNS_ROOT.exists() and folder.exists():
                    for child in sorted(
                        [x for x in folder.iterdir() if x.is_dir() and not x.name.startswith('.')],
                        key=lambda x: x.name.lower(),
                    ):
                        folders.append(folder_meta(child))
                if phase in ('items', 'all') and folder.exists():
                    # Root: direct files only. Inside a project: recursive gallery.
                    walker = folder.rglob if folder_rel else folder.glob
                    files = list(walker('*.layout.json'))
                    if include_images:
                        for ext in IMAGE_EXTS:
                            files.extend(walker(f'*{ext}'))
                    seen = set()
                    for p in sorted(files, key=lambda x: x.stat().st_mtime, reverse=True):
                        rp = p.resolve()
                        if rp in seen or not any(under(rp, r) for r in ALLOWED_ROOTS):
                            continue
                        seen.add(rp)
                        if rp.name.endswith('.layout.json'):
                            items.append(layout_meta(rp, light=light))
                        elif rp.suffix.lower() in IMAGE_EXTS:
                            items.append(image_meta(rp, light=light))
                parent = ''
                if folder_rel:
                    parent = '/'.join(folder_rel.split('/')[:-1])
                self._json(200, {
                    'ok': True,
                    'campaigns_root': str(CAMPAIGNS_ROOT),
                    'folder': folder_rel,
                    'parent': parent,
                    'phase': phase,
                    'folders': folders,
                    'folder_count': len(folders),
                    'count': len(items),
                    'items': items,
                })
                return
            if parsed.path == '/api/load-layout':
                q = parse_qs(parsed.query)
                p = resolve_allowed_layout((q.get('path') or [''])[0])
                data = json.loads(p.read_text(encoding='utf-8'))
                self._json(200, {'ok': True, 'path': public_path(p), 'layout': data})
                return
            if parsed.path == '/api/layout-preview':
                from library_preview import preview_sidecar_path
                q = parse_qs(parsed.query)
                layout_path = resolve_allowed_layout((q.get('path') or [''])[0])
                side = preview_sidecar_path(layout_path)
                if not side.exists():
                    self._json(404, {'ok': False, 'error': 'Preview not found'})
                    return
                data = side.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'public, max-age=3600')
                self._allow_cache = True
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == '/api/file':
                q = parse_qs(parsed.query)
                p = resolve_allowed_file((q.get('path') or [''])[0])
                data = p.read_bytes()
                ctype = mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == '/api/fonts':
                from host_fonts import fonts_payload
                self._json(200, fonts_payload())
                return
            if parsed.path == '/api/live/state':
                from live_session import SESSION
                state = SESSION.get_state()
                self._json(200, {
                    'ok': True,
                    'connected': SESSION.client_count() > 0,
                    'state': state,
                })
                return
            if parsed.path == '/api/live/stream':
                self._serve_live_stream()
                return
            if parsed.path == '/api/font-file':
                from host_fonts import resolve_font_file
                q = parse_qs(parsed.query)
                p = resolve_font_file((q.get('id') or [''])[0])
                data = p.read_bytes()
                ctype = mimetypes.guess_type(str(p))[0] or 'font/ttf'
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self._allow_cache = True
                self.end_headers()
                self.wfile.write(data)
                return
        except Exception as e:
            self._json(400, {'ok': False, 'error': str(e)})
            return
        super().do_GET()

    def _serve_live_stream(self):
        """Long-lived SSE response. ThreadingHTTPServer gives each client its own thread."""
        from live_session import HEARTBEAT_SECONDS, SESSION, sse_frame, sse_heartbeat
        import queue as _queue

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        sub = SESSION.subscribe()
        try:
            self.wfile.write(sse_frame('hello', {'clients': SESSION.client_count()}))
            self.wfile.flush()
            while True:
                try:
                    event, data = sub.get(timeout=HEARTBEAT_SECONDS)
                    self.wfile.write(sse_frame(event, data))
                except _queue.Empty:
                    self.wfile.write(sse_heartbeat())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            SESSION.unsubscribe(sub)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in [
            '/api/save-layout',
            '/api/save-layout-as',
            '/api/delete-layout',
            '/api/delete-library-items',
            '/api/create-layout-from-image',
            '/api/export',
            '/api/patch-layers',
            '/api/save-preview',
            '/api/live/state',
            '/api/live/patch',
        ]:
            self.send_error(404, 'Unknown API endpoint')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
            if parsed.path == '/api/delete-library-items':
                raw_items = payload.get('items') or []
                if not isinstance(raw_items, list) or not raw_items:
                    raise ValueError('Missing items[]')
                deleted = []
                errors = []
                for entry in raw_items:
                    if not isinstance(entry, dict):
                        errors.append('invalid item')
                        continue
                    try:
                        deleted.append(delete_library_target(entry.get('kind'), entry.get('path') or entry.get('rel') or ''))
                    except Exception as e:
                        errors.append(str(e))
                self._json(200 if deleted and not errors else (207 if deleted else 400), {
                    'ok': bool(deleted) and not errors,
                    'deleted': deleted,
                    'errors': errors,
                })
                return
            if parsed.path == '/api/save-preview':
                from library_preview import preview_sidecar_path
                target = resolve_allowed_layout(payload.get('path'))
                raw_b64 = payload.get('image_base64') or ''
                if ',' in raw_b64:
                    raw_b64 = raw_b64.split(',', 1)[1]
                if not raw_b64:
                    raise ValueError('Missing image_base64')
                jpeg = base64.b64decode(raw_b64)
                if len(jpeg) < 32:
                    raise ValueError('Preview too small')
                side = preview_sidecar_path(target)
                side.write_bytes(jpeg)
                self._json(200, {
                    'ok': True,
                    'path': public_path(target),
                    'preview_src': '/api/layout-preview?path=' + public_path(target),
                    'bytes': len(jpeg),
                })
                return

            if parsed.path == '/api/create-layout-from-image':
                image_path = resolve_allowed_image(payload.get('path'))
                target = image_path.with_name(image_path.stem + '.layout.json')
                if target.exists() and not payload.get('overwrite'):
                    layout = json.loads(target.read_text(encoding='utf-8'))
                else:
                    layout = make_layout_from_image(image_path)
                    target.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
                self._json(200, {'ok': True, 'path': public_path(target), 'layout': layout, 'created': True})
                return

            if parsed.path == '/api/live/state':
                from live_session import SESSION
                SESSION.set_state({
                    'path': payload.get('path'),
                    'canvas': payload.get('canvas'),
                    'layers': payload.get('layers') or [],
                    'selectedIds': payload.get('selectedIds') or [],
                    'dirty': bool(payload.get('dirty')),
                })
                self._json(200, {'ok': True})
                return

            if parsed.path == '/api/live/patch':
                from live_session import SESSION, build_live_ops
                ops = build_live_ops(payload)
                delivered = SESSION.broadcast('patch', {
                    **ops,
                    'autosave': payload.get('autosave', True),
                    'label': payload.get('label') or 'agent',
                })
                self._json(200 if delivered else 409, {
                    'ok': bool(delivered),
                    'delivered_to': delivered,
                    'error': None if delivered else 'No editor connected. Open the editor, or use /api/patch-layers to edit the file directly.',
                })
                return

            if parsed.path == '/api/patch-layers':
                target = resolve_allowed_layout(payload.get('path'))
                layout = json.loads(target.read_text(encoding='utf-8'))
                from patch_layers import apply_patches
                result = apply_patches(layout, payload.get('patches') or [])
                target.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
                body = {
                    'ok': True,
                    'path': public_path(target),
                    'bytes': target.stat().st_size,
                    **result,
                }
                if payload.get('return_layout'):
                    body['layout'] = layout
                self._json(200, body)
                return

            if parsed.path == '/api/export':
                layout = payload.get('layout')
                src_path = payload.get('path')
                layout_file = None
                if layout is None and src_path:
                    layout_file = resolve_allowed_layout(src_path)
                    layout = json.loads(layout_file.read_text(encoding='utf-8'))
                if not isinstance(layout, dict):
                    raise ValueError('Missing layout object or path')
                from export_render import render_layout_png_bytes
                origin = f'http://127.0.0.1:{PORT}'
                png = render_layout_png_bytes(layout, origin=origin)
                out_raw = payload.get('out')
                saved = None
                if out_raw:
                    out_path = resolve_allowed_any(out_raw)
                    if out_path.suffix.lower() != '.png':
                        out_path = out_path.with_suffix('.png')
                    if not any(under(out_path, r) for r in ALLOWED_ROOTS):
                        raise ValueError('out outside allowed roots')
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_bytes(png)
                    saved = public_path(out_path)
                elif layout_file is not None and payload.get('auto_out', True):
                    # Agent default: write beside layout in exports/
                    out_path = (layout_file.parent / 'exports' / (layout_file.name.replace('.layout.json', '') + '.png')).resolve()
                    if not any(under(out_path, r) for r in ALLOWED_ROOTS):
                        raise ValueError('auto out outside allowed roots')
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_bytes(png)
                    saved = public_path(out_path)

                # Agent-friendly defaults: JSON when saved to disk; raw PNG only if download=true or return_base64
                if payload.get('return_base64'):
                    self._json(200, {
                        'ok': True,
                        'path': saved,
                        'bytes': len(png),
                        'png_base64': base64.b64encode(png).decode('ascii'),
                    })
                    return
                if saved and not payload.get('download'):
                    self._json(200, {'ok': True, 'path': saved, 'bytes': len(png)})
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(png)))
                if saved:
                    self.send_header('X-Roby-Saved-Path', saved)
                self.end_headers()
                self.wfile.write(png)
                return

            current_path = resolve_allowed_layout(payload.get('path'))
            if parsed.path == '/api/delete-layout':
                result = delete_library_target('layout', payload.get('path'))
                self._json(200, {'ok': True, **result})
                return
            layout = payload.get('layout')
            if not isinstance(layout, dict):
                raise ValueError('Missing layout object')
            if parsed.path == '/api/save-layout':
                target = current_path
            else:
                filename = clean_layout_filename(payload.get('filename'))
                target = (current_path.parent / filename).resolve()
                if not any(under(target, r) for r in ALLOWED_ROOTS):
                    raise ValueError('Target outside allowed roots is not allowed')
                if not target.name.endswith('.layout.json'):
                    raise ValueError('Only .layout.json files can be saved')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
            self._json(200, {'ok': True, 'path': public_path(target), 'bytes': target.stat().st_size})
        except Exception as e:
            self._json(400, {'ok': False, 'error': str(e)})


os.chdir(ROOT)
print('Roby Visual Layout Editor')
print(f'Serving: {ROOT}')
print(f'Campaign layouts/assets: {CAMPAIGNS_ROOT}')
try:
    from host_fonts import fonts_roots, scan_host_fonts
    _fonts = scan_host_fonts()
    print(f'Host fonts: {len(_fonts)} families from {fonts_roots()}')
except Exception as e:
    print(f'Host fonts: unavailable ({e})')
print(f'Bind: {HOST}:{PORT}')
print(f'Open local: http://127.0.0.1:{PORT}')
if HOST in ('0.0.0.0', ''):
    lan_ip = os.environ.get('ROBY_LAYOUT_LAN_IP') or local_lan_ip()
    if lan_ip:
        print(f'Open LAN: http://{lan_ip}:{PORT}')
    elif in_docker():
        print(f'Open LAN: http://<mac-lan-ip>:{PORT} (IP del Mac host, vedi docs/SETUP-DOCKER-E-REMOTE.md)')
ThreadingHTTPServer((HOST, PORT), RobyLayoutHandler).serve_forever()
