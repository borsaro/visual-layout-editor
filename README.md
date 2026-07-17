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

## Funzioni v0

- Canvas con formati preset: feed 1080x1350, story/reel 1080x1920, square 1080x1080, custom.
- Layer di tipo:
  - text
  - image
  - rect/box
- Drag & drop su canvas.
- Resize con maniglia in basso a destra.
- Editing proprietà:
  - x/y/w/h
  - opacity
  - z-index
  - testo
  - font size/weight/style
  - colore testo/fill/bordo
  - border radius
  - object-fit: contain / cover / stretch
- Import immagini come data URL, così l'export canvas non viene bloccato da CORS/local file.
- Salva/carica `layout.json`.
- Export PNG dal browser.

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

## Nota importante

L'editor non sostituisce il generatore. Serve come livello manuale sopra la generazione automatica: Roby produce bene al primo colpo, ma lascia sempre una porta visuale per rifiniture precise.
