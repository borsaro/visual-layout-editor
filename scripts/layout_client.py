"""Minimal stdlib HTTP client for the layout editor API (shared by CLI and scripts)."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = os.environ.get(
    'ROBY_LAYOUT_EDITOR_URL',
    'http://127.0.0.1:' + os.environ.get('ROBY_LAYOUT_EDITOR_PORT', '8765'),
)


class ApiError(RuntimeError):
    def __init__(self, status, body):
        super().__init__(f'HTTP {status}: {body}')
        self.status = status
        self.body = body


class LayoutClient:
    def __init__(self, base=DEFAULT_BASE, timeout=120):
        self.base = base.rstrip('/')
        self.timeout = timeout

    def _call(self, method, endpoint, params=None, payload=None):
        url = self.base + endpoint
        if params:
            url += '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = json.dumps(payload).encode('utf-8') if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        if data:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read().decode('utf-8') or '{}')
        except urllib.error.HTTPError as e:
            raise ApiError(e.code, e.read().decode('utf-8', 'replace')) from None
        except urllib.error.URLError as e:
            raise RuntimeError(f'Editor non raggiungibile su {self.base} ({e.reason}). '
                               f'Avvia scripts/run_server.py.') from None

    def get(self, endpoint, **params):
        return self._call('GET', endpoint, params=params)

    def post(self, endpoint, payload):
        return self._call('POST', endpoint, payload=payload)
