"""API catalog for agents / LLM tools (returned by GET /api/health)."""

ENDPOINTS = [
    {'method': 'GET', 'path': '/api/health', 'desc': 'Health + capabilities + endpoint catalog'},
    {'method': 'GET', 'path': '/api/list-layouts', 'desc': 'List campaign folders/layouts/images?folder=&phase=folders|items|all&light=1'},
    {'method': 'GET', 'path': '/api/load-layout', 'desc': 'Load layout JSON?path='},
    {'method': 'GET', 'path': '/api/layout-preview', 'desc': 'Serve layout sidecar JPEG preview?path='},
    {'method': 'GET', 'path': '/api/variants', 'desc': 'Read the variant set of a layout?path= (with staleness flags)'},
    {'method': 'GET', 'path': '/api/variant-thumb', 'desc': 'Serve one variant thumbnail?path=&id='},
    {'method': 'POST', 'path': '/api/variants', 'desc': 'Save variants {path, variants:[{id,label,axes,ops}], replace?, thumbnails?}'},
    {'method': 'POST', 'path': '/api/variants/promote', 'desc': 'Bake one variant into its own layout {path, id, filename?}'},
    {'method': 'POST', 'path': '/api/variants/delete', 'desc': 'Drop variants from the set {path, ids:[]}'},
    {'method': 'POST', 'path': '/api/remove-background', 'desc': 'Cut subject out of an image {path, model?, out?, layout?, layer_id?, alpha_matting?, decontaminate?, feather?} → writes <name>-cutout.png beside the source'},
    {'method': 'POST', 'path': '/api/bg-models', 'desc': 'Background-removal model catalog: sizes, licences, downloaded state'},
    {'method': 'GET', 'path': '/api/file', 'desc': 'Serve image bytes?path= (_assets/… or campaign-relative)'},
    {'method': 'GET', 'path': '/api/fonts', 'desc': 'List host Font Book families (Docker-mounted Mac fonts)'},
    {'method': 'GET', 'path': '/api/font-file', 'desc': 'Serve one host font file?id='},
    {'method': 'POST', 'path': '/api/save-layout', 'desc': 'Overwrite layout {path, layout}'},
    {'method': 'POST', 'path': '/api/save-layout-as', 'desc': 'Save copy {path, filename, layout}'},
    {'method': 'POST', 'path': '/api/save-preview', 'desc': 'Save layout thumbnail JPEG {path, image_base64}'},
    {'method': 'POST', 'path': '/api/delete-layout', 'desc': 'Delete .layout.json {path}'},
    {'method': 'POST', 'path': '/api/delete-library-items', 'desc': 'Delete layouts/images/folders {items:[{kind,path}]}'},
    {'method': 'POST', 'path': '/api/create-layout-from-image', 'desc': 'Create sidecar layout from image {path}'},
    {
        'method': 'POST',
        'path': '/api/export',
        'desc': 'Server-side PNG via Playwright. Body: {path|layout, out?, download?, return_base64?}',
    },
    {
        'method': 'POST',
        'path': '/api/patch-layers',
        'desc': 'Patch layer fields (locked/visible/…) without rewriting whole file. {path, patches:[{id|name, ...fields}]}',
    },
    {
        'method': 'GET',
        'path': '/api/live/stream',
        'desc': 'SSE stream one editor tab subscribes to (?client=). Isolated per tab',
    },
    {
        'method': 'GET',
        'path': '/api/live/state',
        'desc': 'Open editor session(s)?path=&client=. One design when filtered; sessions[] if several',
    },
    {
        'method': 'POST',
        'path': '/api/live/state',
        'desc': 'Editor publishes its own state {client, path, canvas, layers, selectedIds, dirty}',
    },
    {
        'method': 'POST',
        'path': '/api/live/patch',
        'desc': 'Push a live edit {patches?, add?, remove?, autosave?, path?, client?}. '
                'Targets one design. 409 when no matching editor',
    },
]

SHAPE_KINDS = [
    'rect', 'ellipse', 'triangle', 'diamond',
    'pentagon', 'hexagon', 'octagon', 'star', 'polygon',
]

LAYER_TYPES = {
    'text': {
        'desc': 'Styled text block, soft-wrapped to the layer box',
        'fields': [
            'text', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color',
            'align', 'vAlign', 'lineHeight', 'letterSpacing', 'textTransform',
            'underline', 'strikethrough', 'glow',
        ],
    },
    'rect': {
        'desc': 'Rounded rectangle box',
        'fields': ['fill', 'stroke', 'strokeWidth', 'radius'],
    },
    'image': {
        'desc': 'Bitmap layer with fit, crop, color adjust and black key',
        'fields': ['src', 'fit', 'crop', 'adjust', 'keyBlack'],
    },
    'gradient': {
        'desc': 'Linear or radial gradient panel',
        'fields': ['gradientType', 'angle', 'stops', 'radius'],
    },
    'shape': {
        'desc': 'Vector shape from a preset, optionally warped vertex by vertex',
        'fields': ['shapeKind', 'sides', 'corner', 'fill', 'fillEnabled', 'stroke', 'strokeWidth', 'points'],
    },
}

# Root of a .layout.json file.
LAYOUT_ROOT = {
    'canvas': {
        'type': 'object',
        'desc': 'Artboard: {width, height, background}. background is a hex color',
        'default': {'width': 1080, 'height': 1350, 'background': '#fff7ea'},
    },
    'layers': {
        'type': 'array',
        'desc': 'Layers painted bottom-up by z. Each entry follows the layer schema below',
    },
}

# Every layer type accepts these, on top of its own fields.
COMMON_LAYER_FIELDS = [
    'id', 'type', 'name', 'x', 'y', 'w', 'h', 'z',
    'opacity', 'rotation', 'skewX', 'skewY', 'warp', 'blendMode', 'visible', 'locked', 'shadow',
]

LAYER_FIELDS_FOR_AGENTS = {
    'id': {'type': 'string', 'desc': 'Unique layer id. Patches target a layer by id, so keep it stable'},
    'type': {
        'type': 'string',
        'enum': list(LAYER_TYPES),
        'desc': 'Layer kind. Decides which type-specific fields apply',
    },
    'name': {'type': 'string', 'desc': 'Label in the layer list. Patches may target a unique name instead of id'},
    'x': {'type': 'number', 'desc': 'Left edge in canvas px, origin top-left'},
    'y': {'type': 'number', 'desc': 'Top edge in canvas px, origin top-left'},
    'w': {'type': 'number', 'desc': 'Box width in px'},
    'h': {'type': 'number', 'desc': 'Box height in px. Text wraps inside this box'},
    'z': {'type': 'number', 'desc': 'Stacking order, higher paints on top'},
    'opacity': {'type': 'number', 'default': 1, 'desc': 'Layer opacity 0..1'},
    'rotation': {'type': 'number', 'default': 0, 'desc': 'Rotation in degrees around the box center'},
    'text': {'type': 'string', 'desc': 'Text content. \\n forces a line break; the rest soft-wraps to w'},
    'fontFamily': {'type': 'string', 'desc': 'Family name as installed on the host (GET /api/fonts)'},
    'fontSize': {'type': 'number', 'desc': 'Font size in px'},
    'fontWeight': {'type': 'string', 'desc': 'Numeric weight 100..900 as a string, e.g. "800"'},
    'fontStyle': {
        'type': 'string',
        'enum': ['normal', 'italic'],
        'desc': 'italic needs a real italic face installed; use skewX for a synthetic slant',
    },
    'color': {'type': 'string', 'desc': 'Text color, hex like #111111'},
    'align': {'type': 'string', 'enum': ['left', 'center', 'right'], 'desc': 'Horizontal text alignment'},
    'vAlign': {'type': 'string', 'enum': ['top', 'middle', 'bottom'], 'desc': 'Vertical alignment inside the box'},
    'lineHeight': {'type': 'number', 'default': 1.12, 'desc': 'Line height as a multiple of fontSize'},
    'letterSpacing': {'type': 'number', 'default': 0, 'desc': 'Extra tracking in px, negative tightens'},
    'textTransform': {
        'type': 'string',
        'enum': ['none', 'uppercase', 'lowercase', 'capitalize', 'camelCase'],
        'desc': 'Case conversion applied before wrapping',
    },
    'underline': {'type': 'boolean', 'default': False, 'desc': 'Text only: underline'},
    'strikethrough': {'type': 'boolean', 'default': False, 'desc': 'Text only: line through'},
    'fill': {'type': 'string', 'desc': 'Fill color for rect and shape, hex'},
    'stroke': {'type': 'string', 'desc': 'Border color for rect and shape, hex'},
    'strokeWidth': {'type': 'number', 'default': 0, 'desc': 'Border thickness in px, 0 hides the border'},
    'radius': {'type': 'number', 'default': 0, 'desc': 'Corner radius in px for rect and gradient'},
    'fit': {
        'type': 'string',
        'enum': ['contain', 'cover', 'stretch'],
        'default': 'contain',
        'desc': 'How the bitmap fits its box',
    },
    'crop': {'type': 'object', 'desc': 'Image only: {x,y,w,h} normalized 0..1 source crop'},
    'maskKind': {
        'type': 'string',
        'enum': ['none'] + SHAPE_KINDS,
        'desc': 'Image only: clip the image through a shape. Same presets as shape '
                'layers; none (or null) removes the mask. The rectangular crop field '
                'is unrelated: crop picks the source region, the mask cuts the outline.',
        'example_patch': {'id': 'layer_photo', 'maskKind': 'hexagon', 'maskCorner': 24},
    },
    'maskSides': {'type': 'integer', 'default': 6, 'desc': 'Image mask: sides/points for polygon and star kinds'},
    'maskCorner': {'type': 'number', 'default': 0, 'desc': 'Image mask: corner rounding in px, composes with hand-moved vertices'},
    'maskPoints': {
        'type': 'array',
        'desc': 'Image mask: [[x,y]…] normalized 0..1 vertices, like shape points. '
                'Set to warp the mask outline; null returns to the preset shape.',
    },
    'adjust': {
        'type': 'object',
        'desc': 'Image only: {brightness,contrast,saturate} in -100..100 plus {vivid} in 0..100',
    },
    'gradientType': {'type': 'string', 'enum': ['linear', 'radial'], 'desc': 'Gradient geometry'},
    'angle': {'type': 'number', 'default': 180, 'desc': 'Linear gradient angle in degrees'},
    'stops': {
        'type': 'array',
        'desc': 'Gradient stops [{offset 0..1, color, alpha 0..1}, …], sorted by offset',
    },
    'locked': {
        'type': 'boolean',
        'default': False,
        'desc': 'If true, UI blocks drag/resize/edit. Agents set via JSON or POST /api/patch-layers',
        'example_patch': {'id': 'layer_background_image', 'locked': True},
    },
    'skewX': {
        'type': 'number',
        'default': 0,
        'desc': 'Horizontal slant in degrees, any layer type. On text it obliques the glyphs '
                'themselves, so it works on fonts with no italic face. Applied after rotation.',
        'example_patch': {'id': 'layer_title', 'skewX': -12},
    },
    'skewY': {'type': 'number', 'default': 0, 'desc': 'Vertical slant in degrees, applied after rotation'},
    'warp': {
        'type': 'array',
        'desc': 'Free corner distort: [[x,y] x 4] for top-left, top-right, bottom-right, '
                'bottom-left, normalized to the box (0,0 = top-left corner, 1,1 = bottom-right). '
                'Four independent corners give a perspective distort, unlike skewX/skewY which '
                'stay affine. Omit or use the identity [[0,0],[1,0],[1,1],[0,1]] for no distort. '
                'Three collinear corners are degenerate and are rejected.',
        'example_patch': {
            'id': 'layer_title',
            'warp': [[0.06, 0.02], [1, 0], [0.94, 0.98], [0, 1]],
        },
    },
    'shapeKind': {
        'type': 'string',
        'enum': SHAPE_KINDS,
        'default': 'rect',
        'desc': 'Shape layer preset. Changing it discards hand-warped points',
    },
    'sides': {
        'type': 'integer',
        'default': 6,
        'desc': 'Vertex count for shapeKind=polygon, point count for shapeKind=star (3-32)',
    },
    'corner': {'type': 'number', 'default': 0, 'desc': 'Shape corner rounding in px, clamped per edge'},
    'fillEnabled': {
        'type': 'boolean',
        'default': True,
        'desc': 'Shape only: false renders stroke without fill',
    },
    'points': {
        'type': 'array',
        'desc': 'Shape only: [[x,y], …] normalized 0..1 vertices relative to w/h, min 3. '
                'Set it to warp the shape into an irregular polygon; null restores the preset. '
                'Values outside 0..1 push a vertex past the layer box (clamped to -1..2).',
        'example_patch': {'id': 'layer_badge', 'points': [[0.1, 0], [1, 0.15], [0.85, 1], [0, 0.8]]},
    },
    'visible': {'type': 'boolean', 'default': True, 'desc': 'Hide layer in editor and export'},
    'blendMode': {
        'type': 'string',
        'enum': ['normal', 'screen', 'multiply', 'overlay', 'lighter'],
        'desc': 'Canvas/CSS blend mode',
    },
    'src': {
        'type': 'string',
        'desc': 'Image source: _assets/… or campaign-relative path (prefer over base64)',
    },
    'shadow': {'type': 'object', 'desc': '{enabled,color,blur,offsetX,offsetY,opacity}'},
    'glow': {'type': 'object', 'desc': 'Text only: {enabled,color,blur,opacity}'},
    'keyBlack': {'type': 'object', 'desc': 'Image color key: {enabled,color,threshold,softness}'},
}


def health_payload(campaigns_root: str, editor_root: str, export_ready: bool, export_error: str | None = None):
    return {
        'ok': True,
        'app': 'roby-visual-layout-editor',
        'campaigns_root': campaigns_root,
        'editor_root': editor_root,
        'endpoints': ENDPOINTS,
        'features': {
            'blend_modes': True,
            'shadow_glow': True,
            'gradient_layer': True,
            'path_assets': True,
            'host_fonts': True,
            'server_export_png': True,
            'export_ready': export_ready,
            'export_error': export_error,
            'layer_lock': True,
            'black_key': True,
            'campaigns_root_indicator': True,
            'shape_layers': True,
            'skew_transform': True,
            'vertex_warp': True,
            'live_session': True,
            'live_multi_user': True,
            'mcp_server': True,
        },
        'agent': {
            'lock_layers': {
                'how': 'Set layers[].locked=true in layout JSON, or POST /api/patch-layers',
                'field': 'locked',
            },
            'export_png': {
                'how': 'POST /api/export with path + out (JSON response) or path only (raw PNG)',
                'example': {
                    'path': 'my-campaign/foo.layout.json',
                    'out': 'my-campaign/exports/foo.png',
                },
            },
            'add_layer': {
                'how': 'POST /api/patch-layers only edits existing layers. To add one, load the '
                       'layout, append to layers[] with a unique id and z, then POST /api/save-layout',
                'layer_types': list(LAYER_TYPES),
            },
            'slant_text': {
                'how': 'Set skewX on the text layer. Works on any font, unlike fontStyle=italic '
                       'which needs an installed italic face',
                'field': 'skewX',
            },
            'irregular_shape': {
                'how': 'Create a shape layer, then set points[] to normalized 0..1 vertices to drag '
                       'each corner independently',
                'field': 'points',
            },
            'crop_image': {
                'how': 'Set crop {x,y,w,h} normalized 0..1 on an image layer to choose the '
                       'source region shown in the box; the box itself stays put. Keep '
                       'w/h in the same ratio as the layer box to avoid distortion with '
                       'fit stretch. For non-rectangular outlines use maskKind/maskPoints '
                       'instead — crop picks the region, the mask cuts the outline.',
                'example_patch': {'id': 'layer_photo', 'crop': {'x': 0.1, 'y': 0, 'w': 0.8, 'h': 0.8}},
            },
            'mask_image': {
                'how': 'Set maskKind on an image layer to clip it through a shape (hexagon, star, '
                       'ellipse…). maskCorner rounds the corners, maskPoints warps individual '
                       'vertices (normalized 0..1), maskKind none removes it. Works via '
                       'patch_live_layers and patch_layout_file like any other field',
                'prefer_over': 'Baking rounded corners or cutouts into the source PNG: a baked '
                               'radius is frozen at asset resolution and cannot be adjusted in '
                               'the editor, while the mask stays editable and composes with warp',
                'example_patch': {'id': 'layer_photo', 'maskKind': 'rect', 'maskCorner': 24},
            },
            'edit_live': {
                'how': 'GET /api/live/state?path= to read that design on screen, '
                       'POST /api/live/patch with the same path to change it. '
                       'Always pass path when more than one editor may be open. '
                       'Falls back to /api/patch-layers when nothing is open',
                'undo': 'Live edits go through the editor history, so the user can revert with Cmd+Z',
            },
        },
        'layout_root': LAYOUT_ROOT,
        'layer_types': LAYER_TYPES,
        'common_layer_fields': COMMON_LAYER_FIELDS,
        'layer_fields': LAYER_FIELDS_FOR_AGENTS,
    }


def check_export_ready() -> tuple[bool, str | None]:
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception as e:
        return False, f'Playwright missing: {e}'
    return True, None
