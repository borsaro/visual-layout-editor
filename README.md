# Visual Layout Editor for Roby/Hermes

Editor visuale self-contained per correggere manualmente layout generati da Roby prima dell'export finale.

## Obiettivo

Roby continua a generare asset e codice sorgente seguendo le regole del brand. In più, per ogni campagna può produrre un file `layout.json` apribile in questo editor, così le micro-correzioni di posizione/dimensione/testo/colore si fanno a mano senza iterare con il modello.

## Avvio

### Docker (consigliato — persistente e accessibile in LAN)

```bash
cd /Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor
docker compose up -d --build
```

L’immagine include Playwright/Chromium per l’export PNG server-side (`POST /api/export`). Dopo cambi a `Dockerfile` o `requirements.txt` rifai `--build`.

Poi apri:

```text
http://127.0.0.1:8765
```

Da un altro dispositivo sulla stessa Wi‑Fi:

```text
http://<ip-lan-mac>:8765
```

Verifica:

```bash
curl http://127.0.0.1:8765/api/health
docker compose ps
```

I layout e le immagini campagna restano su HermesRack Desktop:

```text
/Users/admin/Desktop/HermesRack/SOCIAL-MEDIA-MANAGER/Liveoakbbq/campaigns
```

Guida completa: `docs/SETUP-DOCKER-E-REMOTE.md`

### Avvio locale (fallback)

```bash
cd /Users/admin/Desktop/HermesRack/FRAMEWORK/visual-layout-editor
python3 scripts/run_server.py
```

## Funzioni

- Canvas con formati preset: feed 1080x1350, story/reel 1080x1920, square 1080x1080, custom.
- Layer di tipo `text`, `rect`, `image`, `gradient`, `shape`.
- Drag & drop, resize con maniglia, lock e visibilità per layer.
- Trasformazioni comuni: x/y/w/h, z, opacity, `rotation`, `skewX`/`skewY`, `blendMode`.
  Lo skew è geometrico, quindi inclina anche i glifi di font senza corsivo.
- Testo: font host (Font Book), size/weight/style, colore, allineamento H e V,
  interlinea, tracking, `textTransform`, sottolineato, barrato, `glow`.
- Forme (`shape`): preset rect, ellipse, triangle, diamond, pentagon, hexagon,
  octagon, star, polygon; arrotondamento angoli, riempimento opzionale, bordo,
  e warp dei vertici in stile Photoshop (doppio click sulla forma, oppure `points[]` nel JSON).
- Immagini: fit contain/cover/stretch, crop, correzione colore, black key.
- Gradienti lineari e radiali con stop e alpha.
- Ombra su ogni layer, glow sul testo.
- Salva/carica `.layout.json`, export PNG dal browser o server-side con Playwright.
- Sessione live: un agente può modificare il layout aperto mentre lo guardi, con undo dall'editor.

## Come si produce un layout

Tre strade, stesso schema. Riferimento completo dei campi: **`docs/LAYOUT-SCHEMA.md`**
(generato da `scripts/api_catalog.py` con `python3 scripts/gen_schema_doc.py`).

### 1. JSON scritto a mano (metodo storico)

L'agente scrive direttamente il `.layout.json` nella root campagne. Nessuna dipendenza,
nessun server richiesto. È il percorso usato da Roby oggi e resta pienamente supportato.

### 2. CLI

```bash
python3 scripts/layout_cli.py schema                 # rigenera docs/LAYOUT-SCHEMA.md
python3 scripts/layout_cli.py capabilities           # feature attive del server
python3 scripts/layout_cli.py list --folder campagna
python3 scripts/layout_cli.py show campagna/a.layout.json --layers
python3 scripts/layout_cli.py patch campagna/a.layout.json --set id=titolo --set skewX=-12
python3 scripts/layout_cli.py add campagna/a.layout.json --json '{"type":"shape","shapeKind":"hexagon","x":80,"y":80,"w":300,"h":300,"fill":"#ff5500"}'
python3 scripts/layout_cli.py live-patch --set id=titolo --set color=#ffffff --path campagna/a.layout.json
python3 scripts/layout_cli.py export campagna/a.layout.json --out campagna/exports/a.png
```

Solo stdlib. `live-patch --path …` colpisce solo l'editor che ha aperto quel layout;
se nessuno ce l'ha, ricade sul file.

### 3. MCP

`docker compose up -d` alza l'editor su `8765` e il server MCP su `8766`. Gli LLM si
collegano via HTTP senza installare nulla in locale:

```bash
python3 mcp-server/install.py --url http://<ip-macchina-docker>:8766/mcp
```

Dettagli e modalità senza Docker: `mcp-server/README.md`.

## Workflow consigliato

1. Roby genera asset finali + sorgenti + `layout.json`.
2. Roby avvia o indica l'URL dell'editor.
3. Tu apri l'editor, carichi il JSON e fai micro-correzioni.
4. Esporti PNG oppure salvi JSON aggiornato.
5. Roby può rileggere il JSON modificato e imparare i delta per migliorare generatori futuri.

## Convenzione file campagna

Dentro ogni campagna:

```text
campaign/
  generated/
    final.png
  editable-layouts/
    03_feed_focus_grande.layout.json
  source/
    generator.py
```

## Reel / Remotion

Questa v0 esporta immagini statiche. Per reel si userà un modulo separato:

- stesso schema JSON per layer statici;
- aggiunta di timeline/keyframe;
- preview ed export MP4 in Remotion.

## Script utili

- `scripts/run_server.py` — avvia server locale statico.
- `scripts/make_layout_from_image.py` — crea un layout base partendo da un'immagine finale come background, utile per annotare/correggere.
- `scripts/layout_cli.py` — CLI per schema, list, show, patch, add, live-patch, export.
- `scripts/gen_schema_doc.py` — rigenera `docs/LAYOUT-SCHEMA.md` da `scripts/api_catalog.py`.
- `scripts/api_catalog.py` — unica sorgente di verità di endpoint, campi layer e ricette per agenti.

## Nota importante

L'editor non sostituisce il generatore. Serve come livello manuale sopra la generazione automatica: Roby produce bene al primo colpo, ma lascia sempre una porta visuale per rifiniture precise.
