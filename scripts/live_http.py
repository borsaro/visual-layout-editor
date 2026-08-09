"""HTTP handlers for the multi-client live agent bridge."""
from __future__ import annotations

import queue
from urllib.parse import parse_qs, urlparse

from live_ops import HEARTBEAT_SECONDS, build_live_ops, sse_frame, sse_heartbeat
from live_session import SESSION, norm_path


def _q(handler, key: str) -> str | None:
    return (parse_qs(urlparse(handler.path).query).get(key) or [''])[0].strip() or None


def serve_state_get(handler) -> None:
    handler._json(200, SESSION.snapshot(client=_q(handler, 'client'), path=_q(handler, 'path')))


def serve_stream(handler) -> None:
    client_id = _q(handler, 'client')
    if not client_id:
        handler._json(400, {'ok': False, 'error': 'client query param required'})
        return

    handler.send_response(200)
    handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Connection', 'keep-alive')
    handler.send_header('X-Accel-Buffering', 'no')
    handler.end_headers()

    sub = SESSION.subscribe(client_id)
    try:
        handler.wfile.write(sse_frame('hello', {
            'client': client_id,
            'sessions': SESSION.client_count(),
        }))
        handler.wfile.flush()
        while True:
            try:
                event, data = sub.get(timeout=HEARTBEAT_SECONDS)
                handler.wfile.write(sse_frame(event, data))
            except queue.Empty:
                handler.wfile.write(sse_heartbeat())
            handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        SESSION.unsubscribe(client_id, sub)


def serve_state_post(handler, payload: dict) -> None:
    client_id = (payload.get('client') or '').strip()
    if not client_id:
        raise ValueError('client required')
    SESSION.set_state(client_id, payload)
    handler._json(200, {'ok': True, 'client': client_id, 'path': norm_path(payload.get('path'))})


def serve_patch(handler, payload: dict) -> None:
    ops = build_live_ops(payload)
    client = (payload.get('client') or '').strip() or None
    path = norm_path(payload.get('path'))
    msg = {
        **ops,
        'autosave': payload.get('autosave', True),
        'label': payload.get('label') or 'agent',
        'client': client,
        'path': path,
    }
    result = SESSION.broadcast('patch', msg, client=client, path=path)
    handler._json(200 if result['ok'] else 409, result)
