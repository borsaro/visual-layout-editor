# Varianti di un annuncio

Versioni alternative dello stesso layout — copy diverso, colori diversi, un'immagine
diversa, o combinazioni — sfogliabili come thumbnail nella barra in fondo all'editor.
Un click le carica sul canvas.

## Una variante non è una copia

È l'insieme di **operazioni da applicare al layout base**, nella stessa forma che
`patch_live_layers` e `/api/patch-layers` già usano:

```json
{
  "id": "v03",
  "label": "Headline più diretta",
  "axes": ["text", "color"],
  "ops": {
    "patches": [{ "id": "title", "text": "Sito pronto in 7 giorni", "color": "#ffffff" }],
    "add":     [{ "id": "badge", "type": "rect", "x": 80, "y": 200, "w": 260, "h": 90, "fill": "#00d68f" }],
    "remove":  ["vecchio_layer"]
  }
}
```

Perché non copie intere: dieci varianti costano un paio di KB invece di dieci layout,
il base resta l'unica fonte di verità (correggi il logo una volta e valgono tutte), e
ogni variante dice da sé cosa cambia. `patches` accetta **qualunque campo patchabile**
(vedi `get_capabilities`): testo, colori, `src` dell'immagine, posizione, `warp`.

## Su disco

```
ad.layout.json          il base, mai toccato dalle varianti
ad.layout.preview.jpg   anteprima del base (preesistente)
ad.variants.json        il set
ad.variants/v03.jpg     una thumbnail per variante
ad-v03.layout.json      prodotto dalla promozione (vedi sotto)
```

Il set porta un `baseFingerprint` — l'impronta di id e tipi dei layer del base. Se il
base cambia in modo da rompere le varianti (un layer che puntavano non c'è più), la
lettura le marca `stale` con l'elenco dei `missingLayers`, e l'editor le disattiva
invece di applicarle a metà.

## Il progetto: base + varianti, un solo salvataggio

L'editor tratta layout base e varianti come **un progetto**. Ci si sposta fra base e
varianti dalla barra, si modifica quello che si vuole, e un solo **Salva Json** scrive
tutto dove va: il base nel `.layout.json`, le varianti nel sidecar.

Cambiare selezione **non perde mai** le modifiche: restano come bozza in memoria e la
card mostra un pallino finché non vengono salvate. L'etichetta `Base •` segnala lo
stesso per il layout base. Il conteggio in fondo alla barra dice quante cose ci sono
da salvare.

Poiché una variante è fatta di override campo per campo, **modificare il base dopo si
propaga**: correggi il logo nel base e tutte le varianti lo ereditano, ciascuna
tenendo i propri scostamenti.

### Creare una variante a mano

**+ Nuova variante** duplica quello che è sul canvas. Partendo dal base pulito le ops
sono vuote e la variante è identica al base: la si modifica e al salvataggio le
differenze diventano le sue ops. Partendo da una variante, si ottiene una copia di
quella.

## Promozione: uscire dal progetto

**Promuovi a layout** appiattisce una variante in un `.layout.json` autonomo accanto al
base. Da quel momento è un layout indipendente: per modificarlo si apre quel file, non
più la variante. La variante resta nel set marcata con il file che ha prodotto, così
non si perde da dove veniva. Si promuove ciò che è su disco, quindi va salvato prima.

**Salva con nome** si comporta di conseguenza: dal base copia anche il set di varianti
sul nuovo nome (le ops descrivono gli stessi layer); da una variante scrive quella
variante appiattita, senza portarsi dietro un set scritto contro un altro base.

### Selezione multipla

Click applica una variante. **Cmd/Ctrl+click** e **Shift+click** invece la spuntano
soltanto, senza toccare il canvas, per eliminarne più di una in un colpo.

## Tool MCP

| Tool | Cosa fa |
| --- | --- |
| `save_variants(path, variants, replace=True, thumbnails=True)` | Scrive il set e rigenera le anteprime. `replace=False` fonde per id. `thumbnails=False` salta il rendering: molto più veloce mentre si itera. |
| `list_variants(path)` | Legge il set con i flag di staleness. |
| `promote_variant(path, variant_id, filename=None)` | Fonde una variante in un layout autonomo. |
| `delete_variants(path, variant_ids)` | Elimina varianti e relative anteprime. |

## Endpoint HTTP

| Metodo | Path |
| --- | --- |
| GET | `/api/variants?path=` |
| GET | `/api/variant-thumb?path=&id=` |
| POST | `/api/variants` |
| POST | `/api/variants/promote` |
| POST | `/api/variants/delete` |

## Note di implementazione

- Le anteprime di un batch sono renderizzate in **una sola sessione Playwright**
  (`export_render.render_layout_thumbs`). Aprendo un browser per variante, dieci
  anteprime costerebbero ~10s invece di ~2s.
- Se il rendering delle anteprime fallisce, il set viene comunque salvato e l'errore
  torna in `thumbnail_error`: le anteprime sono cosmetiche, il set no.
- La barra applica le varianti a uno **snapshot del base** preso alla prima selezione,
  così passare da una variante all'altra non le accumula. Ogni applicazione passa da
  `pushHistory()`, quindi Cmd+Z funziona come per ogni altra modifica.
- Il set di campi applicabili lato editor arriva da `/api/health` (`layer_fields`), lo
  stesso da cui deriva la whitelist del server: una variante vista nell'editor e la
  stessa variante promossa su file non possono divergere.
