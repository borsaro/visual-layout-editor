# Visual Layout Editor — Docker, LAN e accesso remoto

Guida per far girare l'editor in Docker su Mac (HermesRack) e aprirlo da Chrome su un altro dispositivo in LAN, come Sitewatch.

---

## Architettura

```
┌────────────────── Macchina A (Mac con HermesRack) ──────────────┐
│                                                                  │
│   Docker container "roby-visual-layout-editor"                   │
│   ├── UI + API web          → :8765                              │
│   ├── Playwright/Chromium   → POST /api/export (PNG)             │
│   └── volumi montati:                                            │
│       /app        ← FRAMEWORK/visual-layout-editor (codice UI)   │
│       /campaigns  ← HermesRack/.../campaigns (dati)              │
│                                                                  │
│   Hermes / Roby                                                  │
│   └── skill visual-layout-editor → http://127.0.0.1:8765         │
│                                                                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │  Wi‑Fi LAN
┌────────────────────────────┴─────────────────────────────────────┐
│   Macchina B (browser remoto)                                      │
│                                                                    │
│   Chrome → http://192.168.x.x:8765                                 │
│   Libreria layout legge/scrive i file su HermesRack (macchina A)   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Cosa vive dove

| Componente | Dove gira | Note |
|------------|-----------|------|
| Server UI + API | Container Docker (macchina A) | Porta **8765** |
| Layout JSON + immagini campagna | `HermesRack/.../campaigns/` su Desktop | Montato in `/campaigns` |
| Codice editor (HTML/JS) | `FRAMEWORK/visual-layout-editor/` | Montato in `/app` |
| Hermes | Processo locale su macchina A | **Non** dentro Docker |

I file restano sul filesystem HermesRack del Mac: Docker espone solo il servizio web.

---

## 1. Avvio Docker (macchina A)

### Prerequisiti

- Docker Desktop
- Repo in `/Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor`

### Prima volta

```bash
cd /Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor
docker compose up -d --build
```

L’immagine installa **Playwright + Chromium** per `POST /api/export` (PNG server-side). Serve un rebuild dopo cambi a `Dockerfile` / `requirements.txt` / `mcp-server/requirements.txt`.

Il build va fatto **sulla macchina di destinazione** (Hermes). Compose alza due servizi dalla stessa immagine: editor su `8765` e MCP su `8766`. I client LLM non buildano nulla: si registrano solo con l’URL HTTP (`mcp-server/README.md`).

### Comandi utili

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose down          # ferma il container (i file su HermesRack restano)
docker compose up -d --build # rebuild (Playwright/deps)
```

### Verifica

```bash
curl http://127.0.0.1:8765/api/health
# → {"ok": true, "app": "roby-visual-layout-editor", "campaigns_root": "/campaigns", ...}

curl 'http://127.0.0.1:8765/api/list-layouts?folder='
docker compose ps   # devono risultare up: roby-visual-layout-editor e roby-layout-mcp
```

Apri in locale: **http://127.0.0.1:8765** — MCP: **http://127.0.0.1:8766/mcp**

Nella topbar deve comparire `campaigns: /campaigns` (root montata nel container).

### Catalogo API (agenti / LLM)

```bash
curl -s http://127.0.0.1:8765/api/health | python3 -m json.tool
```

In `endpoints` compaiono **`/api/export`** e **`/api/patch-layers`**. Controlla anche `features.export_ready` (serve Playwright nell’immagine).

### Export PNG da API (nel container)

```bash
# Salva su disco campagne e risponde JSON {ok, path, bytes}
curl -s -X POST http://127.0.0.1:8765/api/export \
  -H 'Content-Type: application/json' \
  -d '{"path":"mia-campagna/foo.layout.json","out":"mia-campagna/exports/foo.png"}'

# Solo path → scrive automaticamente …/exports/<nome>.png
curl -s -X POST http://127.0.0.1:8765/api/export \
  -H 'Content-Type: application/json' \
  -d '{"path":"mia-campagna/foo.layout.json"}'
```

### Lock layer da agente (senza UI)

```bash
curl -s -X POST http://127.0.0.1:8765/api/patch-layers \
  -H 'Content-Type: application/json' \
  -d '{"path":"mia-campagna/foo.layout.json","patches":[{"name":"Sfondo","locked":true}]}'
```

Oppure nel JSON: `"locked": true` sul layer.

---

## 2. Path HermesRack (lettura/scrittura file)

Il compose monta la root campagne LiveOakBBQ dal Desktop:

```text
Host:  /Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq/campaigns
Container: /campaigns
```

Salvataggi da **Salva layout** / **Salva con nome** scrivono direttamente lì.

Per cambiare path (altro account Mac o altra cartella campagne), copia `.env.example` in `.env`:

```bash
cp .env.example .env
```

Esempio `.env`:

```env
ROBY_LAYOUT_CAMPAIGNS_HOST_PATH=/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq/campaigns
ROBY_LAYOUT_EDITOR_PORT=8765
```

Poi:

```bash
docker compose up -d
```

---

## 3. Accesso remoto da Chrome (LAN)

Il container ascolta su `0.0.0.0:8765`. Per aprire da un altro PC/tablet sulla stessa Wi‑Fi:

1. Trova l'IP LAN del Mac (Impostazioni → Rete, oppure `ipconfig getifaddr en0`).
2. Apri nel browser remoto:

```text
http://<ip-lan-mac>:8765
```

3. Usa **Libreria layout** come in locale.

### Verifica bind LAN

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
# atteso: TCP *:8765 (LISTEN)

curl -I http://<ip-lan-mac>:8765/
```

### Firewall macOS

Se il browser remoto non raggiunge la porta, consenti connessioni in entrata per Docker Desktop o Python nelle impostazioni Firewall.

---

## 4. Conflitto porta 8765

Se Hermes aveva avviato `python3 scripts/run_server.py` in locale, può bloccare Docker:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
kill <PID>
docker compose up -d
```

Preferire sempre Docker come runner persistente (`restart: unless-stopped`).

---

## 5. Aggiornare il software

```bash
cd /Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor
git pull   # se usi git
docker compose up -d --build
```

I layout in `campaigns/` non vengono toccati: sono fuori dall'immagine.

---

## 6. Fallback senza Docker

Solo locale:

```bash
ROBY_LAYOUT_CAMPAIGNS_ROOT=/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq/campaigns \
  python3 scripts/run_server.py
```

LAN senza Docker:

```bash
ROBY_LAYOUT_EDITOR_HOST=0.0.0.0 \
ROBY_LAYOUT_CAMPAIGNS_ROOT=/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq/campaigns \
  python3 scripts/run_server.py
```

---

## Troubleshooting

| Problema | Causa probabile | Fix |
|----------|-----------------|-----|
| `connection refused` su :8765 | Container fermo | `docker compose up -d` |
| Libreria vuota | Nessun `.layout.json` in `campaigns/` | Verifica path e `/api/list-layouts` |
| Remoto non apre | IP sbagliato / firewall | IP LAN + `lsof` su `*:8765` |
| Salvataggio fallisce | Path fuori `/campaigns` o `/app` | Salva solo sotto la root campagne montata |
| `Empty reply from server` | Processo Python stale sulla porta | `kill` + `docker compose up -d` |

API health: `GET /api/health`  
API libreria: `GET /api/list-layouts?folder=`
