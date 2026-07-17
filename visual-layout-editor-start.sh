#!/usr/bin/env bash
set -euo pipefail

PORT="${ROBY_LAYOUT_EDITOR_PORT:-8765}"

kill_local_server() {
  local pids
  pids="$(pgrep -f "scripts/run_server.py" 2>/dev/null | tr '\n' ' ' | xargs || true)"
  if [[ -n "$pids" ]]; then
    echo "Termino server locale (PID: $pids)"
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    pids="$(pgrep -f "scripts/run_server.py" 2>/dev/null | tr '\n' ' ' | xargs || true)"
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi

  pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null \
    | awk '$1 != "com.docke" && $2 ~ /^[0-9]+$/ {print $2}' | sort -u | tr '\n' ' ' | xargs || true)"
  if [[ -n "$pids" ]]; then
    echo "Termino listener non-Docker su porta $PORT (PID: $pids)"
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null \
      | awk '$1 != "com.docke" && $2 ~ /^[0-9]+$/ {print $2}' | sort -u | tr '\n' ' ' | xargs || true)"
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

kill_local_server

echo "Avvio Docker visual-layout-editor su porta $PORT"
docker compose up -d

if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "OK → http://127.0.0.1:${PORT}"
else
  echo "Container avviato, health check in attesa..."
  docker compose ps
fi
