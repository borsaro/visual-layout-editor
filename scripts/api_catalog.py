"""API catalog for agents / LLM tools (returned by GET /api/health)."""

ENDPOINTS = [
    {'method': 'GET', 'path': '/api/health', 'desc': 'Health + capabilities + endpoint catalog'},
    {'method': 'GET', 'path': '/api/list-layouts', 'desc': 'List campaign folders/layouts/images?folder=&phase=folders|items|all&light=1'},
    {'method': 'GET', 'path': '/api/load-layout', 'desc': 'Load layout JSON?path='},
    {'method': 'GET', 'path': '/api/layout-preview', 'desc': 'Serve layout sidecar JPEG preview?path='},
    {'method': 'GET', 'path': '/api/file', 'desc': 'Serve image bytes?path= (_assets/… or campaign-relative)'},
    {'method': 'GET', 'path': '/api/fonts', 'desc': 'List host Font Book families (Docker-mounted Mac fonts)'},
    {'method': 'GET', 'path': '/api/font-file', 'desc': 'Serve one host font file?id='},
    {'method': 'POST', 'path': '/api/save-layout', 'desc': 'Overwrite layout {path, layout}'},
    {'method': 'POST', 'path': '/api/save-layout-as', 'desc': 'Save copy {path, filename, layout}'},
    {'method': 'POST', 'path': '/api/save-preview', 'desc': 'Save layout thumbnail JPEG {path, image_base64}'},
    {'method': 'POST', 'path': '/api/delete-layout', 'desc': 'Delete .layout.json {path}'},
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
]

LAYER_FIELDS_FOR_AGENTS = {
    'locked': {
        'type': 'boolean',
        'default': False,
        'desc': 'If true, UI blocks drag/resize/edit. Agents set via JSON or POST /api/patch-layers',
        'example_patch': {'id': 'layer_background_image', 'locked': True},
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
    'keyBlack': {'type': 'object', 'desc': 'Image black key: {enabled,threshold,softness}'},
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
        },
        'layer_fields': LAYER_FIELDS_FOR_AGENTS,
    }


def check_export_ready() -> tuple[bool, str | None]:
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception as e:
        return False, f'Playwright missing: {e}'
    return True, None
