"""Multi-client live bridge: each editor tab is a session, keyed by client id.

Agents target a layout path (or a specific client). Two people on different
designs never share patches or on-screen state.
"""
from __future__ import annotations

import queue
import threading
import time

from live_ops import ERR_MULTI, ERR_NO_EDITOR, ERR_NO_MATCH

_QUEUE_MAX = 200


def norm_path(path) -> str | None:
    if not path:
        return None
    p = str(path).strip().replace('\\', '/')
    while p.startswith('./'):
        p = p[2:]
    return p or None


class LiveClient:
    def __init__(self, client_id: str):
        self.client_id = client_id
        self.queue: queue.Queue | None = None
        self.path: str | None = None
        self.state: dict | None = None
        self.updated_at = 0.0

    def summary(self) -> dict:
        layers = (self.state or {}).get('layers') or []
        return {
            'client': self.client_id,
            'path': self.path,
            'dirty': bool((self.state or {}).get('dirty')),
            'canvas': (self.state or {}).get('canvas'),
            'layer_count': len(layers) if isinstance(layers, list) else 0,
            'updated_at': self.updated_at,
            'age_seconds': round(time.time() - self.updated_at, 3) if self.updated_at else None,
            'listening': self.queue is not None,
        }

    def full_state(self) -> dict | None:
        if self.state is None:
            return None
        return {**self.state, **self.summary()}


class LiveHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._clients: dict[str, LiveClient] = {}

    def subscribe(self, client_id: str) -> queue.Queue:
        client_id = (client_id or '').strip()
        if not client_id:
            raise ValueError('client id required')
        q: queue.Queue = queue.Queue(maxsize=_QUEUE_MAX)
        with self._lock:
            entry = self._clients.get(client_id) or LiveClient(client_id)
            entry.queue = q
            self._clients[client_id] = entry
        return q

    def unsubscribe(self, client_id: str, q: queue.Queue) -> None:
        with self._lock:
            entry = self._clients.get(client_id)
            if entry and entry.queue is q:
                del self._clients[client_id]

    def client_count(self) -> int:
        with self._lock:
            return sum(1 for c in self._clients.values() if c.queue is not None)

    def set_state(self, client_id: str, payload: dict) -> None:
        client_id = (client_id or '').strip()
        if not client_id:
            raise ValueError('client id required')
        with self._lock:
            entry = self._clients.get(client_id) or LiveClient(client_id)
            entry.path = norm_path(payload.get('path'))
            entry.state = {
                'path': entry.path,
                'client': client_id,
                'canvas': payload.get('canvas'),
                'layers': payload.get('layers') or [],
                'selectedIds': payload.get('selectedIds') or [],
                'dirty': bool(payload.get('dirty')),
            }
            entry.updated_at = time.time()
            self._clients[client_id] = entry

    def _match(self, client: str | None, path: str | None) -> list[LiveClient]:
        cid = (client or '').strip() or None
        want = norm_path(path)
        return [
            e for e in self._clients.values()
            if (not cid or e.client_id == cid) and (not want or e.path == want)
        ]

    def snapshot(self, *, client: str | None = None, path: str | None = None) -> dict:
        with self._lock:
            filtered = bool((client or '').strip() or norm_path(path))
            matches = self._match(client, path)
            sessions = [c.summary() for c in (matches if filtered else self._clients.values())]
            listening = sum(1 for c in self._clients.values() if c.queue is not None)
            state = None
            error = None
            if len(matches) == 1:
                state = matches[0].full_state()
            elif len(matches) > 1 and filtered:
                newest = max(matches, key=lambda c: c.updated_at)
                state = newest.full_state()
            elif len(matches) > 1:
                error = ERR_MULTI
            elif filtered:
                error = ERR_NO_MATCH
            return {
                'ok': True,
                'connected': listening > 0,
                'sessions': sessions,
                'state': state,
                'error': error,
            }

    def resolve_targets(self, *, client: str | None = None, path: str | None = None):
        with self._lock:
            listening = [c for c in self._clients.values() if c.queue is not None]
            if not listening:
                return [], ERR_NO_EDITOR
            filtered = bool((client or '').strip() or norm_path(path))
            matches = [c for c in self._match(client, path) if c.queue is not None]
            if not filtered:
                if len(listening) == 1:
                    return listening, None
                return [], ERR_MULTI
            if not matches:
                return [], ERR_NO_MATCH
            return matches, None

    def notify(self, event: str, data: dict, *, path: str | None = None,
               exclude: str | None = None) -> int:
        """Fire-and-forget fan-out, unlike broadcast(): a file written on disk is a
        fact, not a request, so nobody listening is not an error. `exclude` keeps the
        editor that did the writing from being told to reload its own save."""
        want = norm_path(path)
        skip = (exclude or '').strip() or None
        with self._lock:
            targets = [
                e for e in self._clients.values()
                if e.queue is not None and e.client_id != skip and (not want or e.path == want)
            ]
        sent = 0
        for entry in targets:
            try:
                entry.queue.put_nowait((event, data))
                sent += 1
            except (queue.Full, AttributeError):
                pass
        return sent

    def broadcast(self, event: str, data: dict, *, client: str | None = None,
                  path: str | None = None) -> dict:
        targets, error = self.resolve_targets(client=client, path=path)
        if error:
            return {'ok': False, 'delivered_to': 0, 'clients': [], 'error': error}
        delivered = []
        for entry in targets:
            try:
                entry.queue.put_nowait((event, data))
                delivered.append(entry.client_id)
            except (queue.Full, AttributeError):
                pass
        return {
            'ok': bool(delivered),
            'delivered_to': len(delivered),
            'clients': delivered,
            'error': None if delivered else ERR_NO_EDITOR,
        }


SESSION = LiveHub()
