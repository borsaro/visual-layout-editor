# MCP server — Roby Visual Layout Editor

Espone l'editor come tool MCP. I tool "live" agiscono sull'editor **aperto nel browser**: le modifiche compaiono
subito sullo schermo e l'utente può annullarle con Cmd+Z. I tool "file" lavorano sui `.layout.json` su disco e
funzionano anche senza editor aperto.

È una delle tre vie per produrre un layout, tutte sullo stesso schema: JSON scritto a mano,
`scripts/layout_cli.py`, oppure questi tool. Riferimento dei campi: `docs/LAYOUT-SCHEMA.md`.

## Installazione

Due scenari. In entrambi `install.py` scrive la voce in `mcp.json` conservando le altre,
con backup `.json.bak`, ed è idempotente: rieseguirlo aggiorna invece di duplicare.

### Docker sulla macchina remota (scenario di produzione)

Il server MCP gira nel container insieme all'editor e parla **streamable HTTP**. Sul client
non si installa nulla: nessun venv, nessuna dipendenza Python.

Sulla macchina remota:

```bash
docker compose up -d --build
```

Alza due servizi: l'editor su `8765` e l'MCP su `8766`. Su ogni macchina che deve usarlo:

```bash
python3 mcp-server/install.py --url http://<ip-macchina-docker>:8766/mcp
```

Che scrive semplicemente:

```json
{ "mcpServers": { "roby-layout-editor": { "type": "http", "url": "http://<ip>:8766/mcp" } } }
```

Chi non ha il repo può incollare quel blocco a mano nel proprio `mcp.json`.

Il container raggiunge l'editor sulla rete interna di compose (`ROBY_EDITOR_URL`), quindi
non dipende dall'IP dell'host. Variabili utili in `docker-compose.yml`:

| Variabile | Default | A cosa serve |
| --- | --- | --- |
| `ROBY_LAYOUT_MCP_PORT` | `8766` | Porta pubblicata sull'host |
| `ROBY_LAYOUT_MCP_ALLOWED_HOSTS` | `*` | Host header ammessi; `*` disattiva la protezione DNS rebinding |

`*` è il default perché l'IP con cui ti collegherai non è noto in anticipo. È la stessa
esposizione dell'editor, che già ascolta su `0.0.0.0` senza autenticazione: tienili su una
rete fidata. Per stringere, elenca gli host: `ROBY_LAYOUT_MCP_ALLOWED_HOSTS=192.168.1.20:8766`.

### Locale senza Docker

Crea il venv, installa le dipendenze e usa il trasporto stdio:

```bash
python3 mcp-server/install.py                      # Cursor, ~/.cursor/mcp.json
python3 mcp-server/install.py --client claude      # ~/.claude/mcp.json
python3 mcp-server/install.py --config /altro/mcp.json
python3 mcp-server/install.py --print              # stampa il blocco senza installare
```

Usa `--editor-url` se l'editor non gira su `http://127.0.0.1:8765`.

In entrambi i casi, riavvia il client MCP per vedere i tool.

### Farlo fare a un LLM

Con Docker già attivo, incolla:

> Registra l'MCP del visual layout editor: esegui
> `python3 /percorso/repo/mcp-server/install.py --url http://<ip-docker>:8766/mcp`,
> poi leggi `docs/LAYOUT-SCHEMA.md` per lo schema dei layer.

Senza Docker, stessa frase senza `--url`.

## Trasporto

`ROBY_MCP_TRANSPORT` sceglie come gira il server: `stdio` (default, avviato dal client)
oppure `streamable-http` con `ROBY_MCP_HOST` e `ROBY_MCP_PORT`. Il compose usa il secondo.

## Tool

### Live — richiedono l'editor aperto

| Tool | Cosa fa |
| --- | --- |
| `get_live_state` | Legge lo schermo di un editor. Passa `path` (o `client`) se ce n'è più di uno |
| `patch_live_layers` | Modifica campi di layer esistenti, per `id` o `name` univoco. Passa `path` |
| `add_live_layers` | Aggiunge layer; `id` e `z` mancanti vengono generati. Passa `path` |
| `remove_live_layers` | Elimina layer per id. Passa `path` |

Se nessun editor è connesso questi tool rispondono `ok: false` con un messaggio che suggerisce i tool file. Con più editor aperti, senza `path`/`client` la risposta elenca `sessions[]` e chiede di sceglierne uno.

### File — funzionano sempre

| Tool | Cosa fa |
| --- | --- |
| `get_capabilities` | Tipi di layer, campi per tipo, endpoint, ricette per agenti |
| `list_layouts` | Elenca cartelle campagna e layout |
| `load_layout` | Legge un `.layout.json` |
| `patch_layout_file` | Patcha un layout su disco |
| `export_png` | Render PNG server-side via Playwright |

## Come funziona il canale live

```
tool MCP (+ path) → POST /api/live/patch → solo i tab con quel layout → render() + autosave
browser tab → POST /api/live/state {client, path} → get_live_state?path= legge quella sessione
```

Il trasporto è Server-Sent Events, non WebSocket: `run_server.py` è basato su `ThreadingHTTPServer` della
stdlib, dove una risposta `text/event-stream` tenuta aperta funziona senza dipendenze aggiuntive e il browser
riconnette da solo.

## Comportamenti da conoscere

**Undo.** Prima di applicare una modifica dell'agente il browser chiama `pushHistory()`, quindi Cmd+Z la annulla
come una modifica manuale.

**Autosave.** Dopo ogni patch live il browser salva su disco, ma solo se il layout è stato aperto dal server
(`state.currentLayoutPath` valorizzato). Un layout aperto da file locale resta segnato come modificato e va
salvato a mano. Passa `autosave: false` per lasciare la modifica solo in sessione.

**Conflitto con il drag.** Se una patch arriva mentre l'utente sta trascinando un layer o un vertice, viene messa
in coda e applicata al rilascio del mouse.

**Più editor aperti.** Ogni tab ha un `client` id. Le patch live vanno solo al design indicato
con `path` (o a un tab con `client`). Due persone su due layout diversi non si interferiscono.
Stesso file aperto in due tab: la patch con quel `path` arriva a entrambi.
