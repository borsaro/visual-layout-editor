#!/usr/bin/env bash
set -euo pipefail

PORT="${ROBY_LAYOUT_EDITOR_PORT:-8765}"

echo "Fermo container Docker"
docker compose down 2>/dev/null || true

pids="$(pgrep -f "scripts/run_server.py" 2>/dev/null | tr '\n' ' ' | xargs || true)"
if [[ -n "$pids" ]]; then
  echo "Termino server locale (PID: $pids)"
  kill -TERM $pids 2>/dev/null || true
  sleep 1
  pids="$(pgrep -f "scripts/run_server.py" 2>/dev/null | tr '\n' ' ' | xargs || true)"
  [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
fi

pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' | xargs || true)"
if [[ -z "$pids" ]]; then
  echo "Porta $PORT libera"
else
  echo "Porta $PORT ancora in uso (PID: $pids)"
fi
