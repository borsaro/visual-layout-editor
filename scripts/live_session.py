"""In-memory bridge between agent tools and the editor open in a browser.

The browser subscribes to /api/live/stream (SSE) and publishes its own state back,
so agents can read what is actually on screen instead of the file on disk.
"""
from __future__ import annotations

import json
import queue
import threading
import time

HEARTBEAT_SECONDS = 20
_QUEUE_MAX = 200


class LiveSession:
    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue] = []
        self._state: dict | None = None
        self._updated_at = 0.0

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=_QUEUE_MAX)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def client_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

    def broadcast(self, event: str, data: dict) -> int:
        """Fan out to every connected editor. Returns how many queues accepted it."""
        with self._lock:
            targets = list(self._subscribers)
        delivered = 0
        for q in targets:
            try:
                q.put_nowait((event, data))
                delivered += 1
            except queue.Full:
                pass
        return delivered

    def set_state(self, state: dict) -> None:
        with self._lock:
            self._state = state
            self._updated_at = time.time()

    def get_state(self) -> dict | None:
        with self._lock:
            if self._state is None:
                return None
            return {
                **self._state,
                'updated_at': self._updated_at,
                'age_seconds': round(time.time() - self._updated_at, 3),
                'clients': len(self._subscribers),
            }


SESSION = LiveSession()


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
