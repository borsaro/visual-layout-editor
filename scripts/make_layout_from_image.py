#!/usr/bin/env python3
"""Create a starter layout JSON with one image layer as full-canvas background.

No third-party dependencies.

Usage:
  python3 scripts/make_layout_from_image.py /path/to/final.jpg --out /path/to/layout.json
"""
from pathlib import Path
import argparse, base64, json, mimetypes, struct


def image_size(path: Path):
    data = path.read_bytes()
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    if data[:2] == b'\xff\xd8':
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i+1]
            i += 2
            if marker in (0xD8, 0xD9):
                continue
            length = struct.unpack('>H', data[i:i+2])[0]
            if marker in [0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF]:
                h, w = struct.unpack('>HH', data[i+3:i+7])
                return w, h
            i += length
    raise ValueError(f'Unsupported image or could not read size: {path}')

parser = argparse.ArgumentParser()
parser.add_argument('image')
parser.add_argument('--out', required=True)
parser.add_argument('--name', default=None)
args = parser.parse_args()
img_path = Path(args.image).expanduser().resolve()
out_path = Path(args.out).expanduser().resolve()
w, h = image_size(img_path)
mime = mimetypes.guess_type(img_path.name)[0] or 'image/png'
data = base64.b64encode(img_path.read_bytes()).decode('ascii')
layout = {
    'version': 1,
    'app': 'roby-visual-layout-editor',
    'canvas': {'width': w, 'height': h, 'background': '#ffffff'},
    'layers': [{
        'id': 'background_image',
        'type': 'image',
        'name': args.name or img_path.name,
        'x': 0, 'y': 0, 'w': w, 'h': h, 'z': 1, 'opacity': 1,
        'src': f'data:{mime};base64,{data}',
        'fit': 'stretch'
    }]
}
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(layout, indent=2, ensure_ascii=False))
print(out_path)
