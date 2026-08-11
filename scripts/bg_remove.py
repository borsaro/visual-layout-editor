"""Background removal: cut a subject out of an image, keeping a usable alpha edge.

The model is only half the job. It predicts a mask at its own working resolution
(1024px for the BiRefNet family), so a naive pipeline hands back a soft, downscaled
mask and the cutout looks blurry against the original pixels. Here the mask is taken
back to the source resolution, and the colour the old background left on semi
transparent pixels is removed — that fringe is what makes a cutout read as "cut out"
even when the shape is perfect.

Models are never baked into the image: each is downloaded on first use into
ROBY_BG_MODELS_DIR, which compose mounts, so a rebuild does not re-download gigabytes.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

# Ordered best-first inside each family. `size_mb` is the real download size, shown in
# the UI so nobody starts a 927 MB download without knowing.
MODEL_CATALOG: list[dict[str, Any]] = [
    {
        'id': 'birefnet-general',
        'label': 'BiRefNet generale',
        'desc': 'Tuttofare di riferimento: prodotti, oggetti, scene. Bordi molto puliti.',
        'size_mb': 927,
        'license': 'MIT',
        'best_for': 'prodotti, oggetti, scene generiche',
    },
    {
        'id': 'birefnet-portrait',
        'label': 'BiRefNet ritratto',
        'desc': 'Addestrato su persone: rende molto meglio capelli e contorni del viso.',
        'size_mb': 927,
        'license': 'MIT',
        'best_for': 'persone, ritratti, modelli',
    },
    {
        'id': 'birefnet-general-lite',
        'label': 'BiRefNet veloce',
        'desc': 'Stessa famiglia con backbone ridotto: molto piu rapido e leggero, '
                'bordi leggermente meno fini. Per provare o per lotti numerosi.',
        'size_mb': 213,
        'license': 'MIT',
        'best_for': 'anteprime rapide, molte immagini',
    },
]

# rembg also ships bria-rmbg. It is CC BY-NC: free for research, a paid agreement for
# anything commercial. Client work is commercial, so it is deliberately not offered —
# an option in a dropdown is an option someone will pick without reading the licence.
EXCLUDED_MODELS = {'bria-rmbg'}

DEFAULT_MODEL = 'birefnet-general'

_sessions: dict[str, Any] = {}
_session_order: list[str] = []
_session_lock = threading.Lock()
# Each BiRefNet session holds ~1 GB of weights plus activations; keeping every model
# a user tries would exhaust the container's memory limit within a few clicks.
MAX_RESIDENT_SESSIONS = int(os.environ.get('ROBY_BG_MAX_SESSIONS', '2'))


def models_dir() -> Path:
    """Where downloaded weights live. Mounted in compose so rebuilds keep them."""
    raw = os.environ.get('ROBY_BG_MODELS_DIR') or os.environ.get('U2NET_HOME')
    if raw:
        return Path(raw).expanduser()
    return Path.home() / '.u2net'


def model_ids() -> list[str]:
    return [m['id'] for m in MODEL_CATALOG]


def resolve_model(name: str | None) -> str:
    model = (name or DEFAULT_MODEL).strip()
    if model in EXCLUDED_MODELS:
        raise ValueError(
            f'{model} non è utilizzabile: licenza CC BY-NC, vietata sui lavori commerciali'
        )
    if model not in model_ids():
        raise ValueError(f'Modello sconosciuto: {model}. Disponibili: {", ".join(model_ids())}')
    return model


def catalog_payload() -> dict[str, Any]:
    """Catalog plus what is already on disk, so the UI can warn before a big download."""
    home = models_dir()
    present = set()
    if home.exists():
        for f in home.glob('*.onnx'):
            present.add(f.stem.lower())

    def downloaded(model_id: str) -> bool:
        # rembg saves weights as exactly '<session-id>.onnx'. A substring match here
        # marked birefnet-general as present when only birefnet-general-lite was.
        return model_id.lower() in present

    return {
        'default': DEFAULT_MODEL,
        'models_dir': str(home),
        'models': [{**m, 'downloaded': downloaded(m['id'])} for m in MODEL_CATALOG],
    }


def _get_session(model: str):
    """Cached rembg session, least-recently-used evicted."""
    with _session_lock:
        if model in _sessions:
            _session_order.remove(model)
            _session_order.append(model)
            return _sessions[model]

    try:
        from rembg import new_session
    except ImportError as e:
        raise RuntimeError(
            'rembg non installato. In Docker: rebuild (`docker compose up -d --build`). '
            'In locale: pip install -r requirements.txt'
        ) from e

    os.environ.setdefault('U2NET_HOME', str(models_dir()))
    models_dir().mkdir(parents=True, exist_ok=True)
    session = new_session(model)   # downloads on first use

    with _session_lock:
        _sessions[model] = session
        _session_order.append(model)
        while len(_session_order) > MAX_RESIDENT_SESSIONS:
            _sessions.pop(_session_order.pop(0), None)
    return session


def _predict_alpha(image, session, alpha_matting: bool, matting_params: dict):
    """Alpha channel at the model's own resolution, as a single-channel image."""
    from rembg import remove

    kwargs: dict[str, Any] = {'session': session, 'only_mask': True, 'post_process_mask': True}
    if alpha_matting:
        kwargs.update(
            alpha_matting=True,
            alpha_matting_foreground_threshold=matting_params.get('foreground', 240),
            alpha_matting_background_threshold=matting_params.get('background', 15),
            alpha_matting_erode_size=matting_params.get('erode', 3),
        )
    return remove(image, **kwargs)


def _decontaminate_edge(rgb, alpha, strength: float):
    """Remove the old background's colour from semi-transparent pixels.

    A pixel that is 40% opaque still carries 60% of whatever was behind it. Composite
    the cutout on a new background and that leftover shows up as a halo — the tell that
    says "cut out" even when the silhouette is perfect. The fix is to estimate the
    subject's own colour by pulling each edge pixel towards nearby fully-opaque pixels,
    proportionally to how transparent it is.
    """
    import numpy as np
    from PIL import ImageFilter

    if strength <= 0:
        return rgb

    a = np.asarray(alpha, dtype=np.float32) / 255.0
    src = np.asarray(rgb, dtype=np.float32)

    # Colour of the solid interior, spread outwards over the soft edge. Blurring the
    # premultiplied colour and dividing by the blurred alpha gives a weighted average
    # of opaque neighbours only, so the background never contributes to the estimate.
    from PIL import Image
    prem = Image.fromarray(np.clip(src * a[..., None], 0, 255).astype(np.uint8))
    weight = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    radius = 4
    prem_b = np.asarray(prem.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    weight_b = np.asarray(weight.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0
    safe = np.maximum(weight_b, 1e-3)[..., None]
    estimate = prem_b / safe

    # Only the partially transparent band is touched; solid pixels stay exactly as shot.
    band = np.clip((1.0 - a) * strength, 0.0, 1.0)[..., None]
    band = np.where(a[..., None] > 0.995, 0.0, band)
    out = src * (1.0 - band) + estimate * band
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def remove_background_image(
    image,
    model: str | None = None,
    alpha_matting: bool = True,
    decontaminate: float = 0.8,
    feather: float = 0.0,
    matting_params: dict | None = None,
):
    """Cut the subject out of a PIL image and return an RGBA PIL image.

    The mask is computed at the model's resolution and resized back to the source, so
    the result keeps every pixel of the original instead of the model's downscale.
    """
    from PIL import Image

    src = image.convert('RGB')
    session = _get_session(resolve_model(model))
    mask = _predict_alpha(src, session, alpha_matting, matting_params or {})
    if mask.size != src.size:
        # LANCZOS on the mask, not NEAREST: a hard-resized mask gives stair-stepped
        # edges that no amount of later refinement can recover.
        mask = mask.resize(src.size, Image.LANCZOS)
    mask = mask.convert('L')

    if feather and feather > 0:
        from PIL import ImageFilter
        mask = mask.filter(ImageFilter.GaussianBlur(float(feather)))

    rgb = _decontaminate_edge(src, mask, float(decontaminate))
    out = rgb.convert('RGBA')
    out.putalpha(mask)
    return out


def cutout_output_path(src_path: Path, out: str | None = None) -> Path:
    """Sidecar beside the source: the original file is never overwritten."""
    if out:
        p = Path(out)
        return p if p.suffix.lower() == '.png' else p.with_suffix('.png')
    return src_path.with_name(src_path.stem + '-cutout.png')


def remove_background_file(src_path: Path, out_path: Path, **kwargs) -> dict[str, Any]:
    from PIL import Image

    with Image.open(src_path) as im:
        im.load()
        result = remove_background_image(im, **kwargs)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(out_path, 'PNG')
    return {
        'width': result.width,
        'height': result.height,
        'bytes': out_path.stat().st_size,
    }
