FROM python:3.13-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    ROBY_LAYOUT_EDITOR_HOST=0.0.0.0 \
    ROBY_LAYOUT_EDITOR_PORT=8765 \
    ROBY_LAYOUT_CAMPAIGNS_ROOT=/campaigns \
    ROBY_LAYOUT_DOCKER=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # Chromium in container: less /dev/shm pressure
    LANG=C.UTF-8

# System deps for Playwright Chromium + curl + fontconfig (host font mounts)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
COPY mcp-server/requirements.txt mcp-server/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r mcp-server/requirements.txt \
    && playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# App code is also bind-mounted in compose; COPY keeps image runnable standalone
COPY . .

EXPOSE 8765 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)"

CMD ["python", "scripts/run_server.py"]
