# Schema layout — riferimento per agenti

> Generato da `scripts/gen_schema_doc.py` a partire da `scripts/api_catalog.py`.
> Non modificarlo a mano: cambia il catalogo e rilancia lo script.

Tre modi per produrre un layout, tutti equivalenti sullo stesso schema:

1. **Scrivere il JSON a mano** nella root campagne (metodo storico, sempre valido).
2. **CLI**: `python3 scripts/layout_cli.py --help` (schema, patch, add, export, live).
3. **MCP**: server in `mcp-server/`, espone gli stessi comandi come tool.

Esempio che usa tutte le funzionalità: `examples/feature-reference.layout.json`.

## File `.layout.json`

```json
{
  "canvas": {
    "width": 1080,
    "height": 1350,
    "background": "#fff7ea"
  },
  "layers": [
    {
      "id": "bg",
      "type": "rect",
      "x": 0,
      "y": 0,
      "w": 1080,
      "h": 1350,
      "z": 0,
      "fill": "#101010"
    }
  ]
}
```

| Chiave | Tipo | Descrizione |
| --- | --- | --- |
| `canvas` | object | Artboard: {width, height, background}. background is a hex color |
| `layers` | array | Layers painted bottom-up by z. Each entry follows the layer schema below |

## Campi comuni a ogni layer

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `id` | string | Unique layer id. Patches target a layer by id, so keep it stable |
| `type` | string | Layer kind. Decides which type-specific fields apply _(uno di: `text`, `rect`, `image`, `gradient`, `shape`)_ |
| `name` | string | Label in the layer list. Patches may target a unique name instead of id |
| `x` | number | Left edge in canvas px, origin top-left |
| `y` | number | Top edge in canvas px, origin top-left |
| `w` | number | Box width in px |
| `h` | number | Box height in px. Text wraps inside this box |
| `z` | number | Stacking order, higher paints on top |
| `opacity` | number | Layer opacity 0..1 _(default `1`)_ |
| `rotation` | number | Rotation in degrees around the box center _(default `0`)_ |
| `skewX` | number | Horizontal slant in degrees, any layer type. On text it obliques the glyphs themselves, so it works on fonts with no italic face. Applied after rotation. _(default `0`)_ |
| `skewY` | number | Vertical slant in degrees, applied after rotation _(default `0`)_ |
| `warp` | array | Free corner distort: [[x,y] x 4] for top-left, top-right, bottom-right, bottom-left, normalized to the box (0,0 = top-left corner, 1,1 = bottom-right). Four independent corners give a perspective distort, unlike skewX/skewY which stay affine. Omit or use the identity [[0,0],[1,0],[1,1],[0,1]] for no distort. Three collinear corners are degenerate and are rejected. |
| `blendMode` | string | Canvas/CSS blend mode _(uno di: `normal`, `screen`, `multiply`, `overlay`, `lighter`)_ |
| `visible` | boolean | Hide layer in editor and export _(default `true`)_ |
| `locked` | boolean | If true, UI blocks drag/resize/edit. Agents set via JSON or POST /api/patch-layers _(default `false`)_ |
| `shadow` | object | {enabled,color,blur,offsetX,offsetY,opacity} |

## Tipi di layer

### `type: "text"`

Styled text block, soft-wrapped to the layer box

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `text` | string | Text content. \n forces a line break; the rest soft-wraps to w |
| `fontFamily` | string | Family name as installed on the host (GET /api/fonts) |
| `fontSize` | number | Font size in px |
| `fontWeight` | string | Numeric weight 100..900 as a string, e.g. "800" |
| `fontStyle` | string | italic needs a real italic face installed; use skewX for a synthetic slant _(uno di: `normal`, `italic`)_ |
| `color` | string | Text color, hex like #111111 |
| `align` | string | Horizontal text alignment _(uno di: `left`, `center`, `right`)_ |
| `vAlign` | string | Vertical alignment inside the box _(uno di: `top`, `middle`, `bottom`)_ |
| `lineHeight` | number | Line height as a multiple of fontSize _(default `1.12`)_ |
| `letterSpacing` | number | Extra tracking in px, negative tightens _(default `0`)_ |
| `textTransform` | string | Case conversion applied before wrapping _(uno di: `none`, `uppercase`, `lowercase`, `capitalize`, `camelCase`)_ |
| `underline` | boolean | Text only: underline _(default `false`)_ |
| `strikethrough` | boolean | Text only: line through _(default `false`)_ |
| `glow` | object | Text only: {enabled,color,blur,opacity} |

### `type: "rect"`

Rounded rectangle box

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `fill` | string | Fill color for rect and shape, hex |
| `stroke` | string | Border color for rect and shape, hex |
| `strokeWidth` | number | Border thickness in px, 0 hides the border _(default `0`)_ |
| `radius` | number | Corner radius in px for rect and gradient _(default `0`)_ |

### `type: "image"`

Bitmap layer with fit, crop, color adjust and black key

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `src` | string | Image source: _assets/… or campaign-relative path (prefer over base64) |
| `fit` | string | How the bitmap fits its box _(uno di: `contain`, `cover`, `stretch`; default `"contain"`)_ |
| `crop` | object | Image only: {x,y,w,h} normalized 0..1 source crop |
| `adjust` | object | Image only: {brightness,contrast,saturate} in -100..100 plus {vivid} in 0..100 |
| `keyBlack` | object | Image color key: {enabled,color,threshold,softness} |

### `type: "gradient"`

Linear or radial gradient panel

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `gradientType` | string | Gradient geometry _(uno di: `linear`, `radial`)_ |
| `angle` | number | Linear gradient angle in degrees _(default `180`)_ |
| `stops` | array | Gradient stops [{offset 0..1, color, alpha 0..1}, …], sorted by offset |
| `radius` | number | Corner radius in px for rect and gradient _(default `0`)_ |

### `type: "shape"`

Vector shape from a preset, optionally warped vertex by vertex

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `shapeKind` | string | Shape layer preset. Changing it discards hand-warped points _(uno di: `rect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`, `star`, `polygon`; default `"rect"`)_ |
| `sides` | integer | Vertex count for shapeKind=polygon, point count for shapeKind=star (3-32) _(default `6`)_ |
| `corner` | number | Shape corner rounding in px, clamped per edge _(default `0`)_ |
| `fill` | string | Fill color for rect and shape, hex |
| `fillEnabled` | boolean | Shape only: false renders stroke without fill _(default `true`)_ |
| `stroke` | string | Border color for rect and shape, hex |
| `strokeWidth` | number | Border thickness in px, 0 hides the border _(default `0`)_ |
| `points` | array | Shape only: [[x,y], …] normalized 0..1 vertices relative to w/h, min 3. Set it to warp the shape into an irregular polygon; null restores the preset. Values outside 0..1 push a vertex past the layer box (clamped to -1..2). |

Preset `shapeKind`: `rect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`, `star`, `polygon`.

## Ricette per agenti

### lock_layers

- **how**: Set layers[].locked=true in layout JSON, or POST /api/patch-layers
- **field**: locked

### export_png

- **how**: POST /api/export with path + out (JSON response) or path only (raw PNG)
- **example**: `{"path": "my-campaign/foo.layout.json", "out": "my-campaign/exports/foo.png"}`

### add_layer

- **how**: POST /api/patch-layers only edits existing layers. To add one, load the layout, append to layers[] with a unique id and z, then POST /api/save-layout
- **layer_types**: `["text", "rect", "image", "gradient", "shape"]`

### slant_text

- **how**: Set skewX on the text layer. Works on any font, unlike fontStyle=italic which needs an installed italic face
- **field**: skewX

### irregular_shape

- **how**: Create a shape layer, then set points[] to normalized 0..1 vertices to drag each corner independently
- **field**: points

### edit_live

- **how**: GET /api/live/state?path= to read that design on screen, POST /api/live/patch with the same path to change it. Always pass path when more than one editor may be open. Falls back to /api/patch-layers when nothing is open
- **undo**: Live edits go through the editor history, so the user can revert with Cmd+Z

## Endpoint HTTP

| Metodo | Path | Descrizione |
| --- | --- | --- |
| `GET` | `/api/health` | Health + capabilities + endpoint catalog |
| `GET` | `/api/list-layouts` | List campaign folders/layouts/images?folder=&phase=folders\|items\|all&light=1 |
| `GET` | `/api/load-layout` | Load layout JSON?path= |
| `GET` | `/api/layout-preview` | Serve layout sidecar JPEG preview?path= |
| `GET` | `/api/variants` | Read the variant set of a layout?path= (with staleness flags) |
| `GET` | `/api/variant-thumb` | Serve one variant thumbnail?path=&id= |
| `POST` | `/api/variants` | Save variants {path, variants:[{id,label,axes,ops}], replace?, thumbnails?} |
| `POST` | `/api/variants/promote` | Bake one variant into its own layout {path, id, filename?} |
| `POST` | `/api/variants/delete` | Drop variants from the set {path, ids:[]} |
| `POST` | `/api/remove-background` | Cut subject out of an image {path, model?, out?, layout?, layer_id?, alpha_matting?, decontaminate?, feather?} → writes <name>-cutout.png beside the source |
| `POST` | `/api/bg-models` | Background-removal model catalog: sizes, licences, downloaded state |
| `GET` | `/api/file` | Serve image bytes?path= (_assets/… or campaign-relative) |
| `GET` | `/api/fonts` | List host Font Book families (Docker-mounted Mac fonts) |
| `GET` | `/api/font-file` | Serve one host font file?id= |
| `POST` | `/api/save-layout` | Overwrite layout {path, layout} |
| `POST` | `/api/save-layout-as` | Save copy {path, filename, layout} |
| `POST` | `/api/save-preview` | Save layout thumbnail JPEG {path, image_base64} |
| `POST` | `/api/delete-layout` | Delete .layout.json {path} |
| `POST` | `/api/delete-library-items` | Delete layouts/images/folders {items:[{kind,path}]} |
| `POST` | `/api/create-layout-from-image` | Create sidecar layout from image {path} |
| `POST` | `/api/export` | Server-side PNG via Playwright. Body: {path\|layout, out?, download?, return_base64?} |
| `POST` | `/api/patch-layers` | Patch layer fields (locked/visible/…) without rewriting whole file. {path, patches:[{id\|name, ...fields}]} |
| `GET` | `/api/live/stream` | SSE stream one editor tab subscribes to (?client=). Isolated per tab |
| `GET` | `/api/live/state` | Open editor session(s)?path=&client=. One design when filtered; sessions[] if several |
| `POST` | `/api/live/state` | Editor publishes its own state {client, path, canvas, layers, selectedIds, dirty} |
| `POST` | `/api/live/patch` | Push a live edit {patches?, add?, remove?, autosave?, path?, client?}. Targets one design. 409 when no matching editor |
