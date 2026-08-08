#!/usr/bin/env python3
"""CLI for the visual layout editor: read the schema, patch files, edit the open editor live.

Examples:
  python3 scripts/layout_cli.py schema --print
  python3 scripts/layout_cli.py list --folder my-campaign
  python3 scripts/layout_cli.py patch my-campaign/a.layout.json --set id=title --set skewX=-12
  python3 scripts/layout_cli.py add my-campaign/a.layout.json --json '{"type":"shape","shapeKind":"hexagon"}'
  python3 scripts/layout_cli.py live-patch --set id=title --set fill=#ff0000
  python3 scripts/layout_cli.py export my-campaign/a.layout.json --out my-campaign/exports/a.png
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout_client import ApiError, LayoutClient  # noqa: E402

HERE = Path(__file__).resolve().parent


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def parse_value(raw):
    """--set k=v: v is JSON when parseable, otherwise a plain string."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def build_patch(args):
    """One patch dict from --json or repeated --set key=value pairs."""
    if args.json:
        parsed = json.loads(args.json)
        return parsed if isinstance(parsed, list) else [parsed]
    patch = {}
    for item in args.set or []:
        if '=' not in item:
            raise SystemExit(f'--set richiede key=value, ricevuto: {item}')
        k, v = item.split('=', 1)
        patch[k] = parse_value(v)
    if not patch:
        raise SystemExit('Serve --set key=value oppure --json')
    if 'id' not in patch and 'name' not in patch:
        raise SystemExit('Il patch deve identificare il layer con id= oppure name=')
    return [patch]


def cmd_schema(client, args):
    if args.print:
        out(client.get('/api/health'))
        return
    subprocess.run([sys.executable, str(HERE / 'gen_schema_doc.py')], check=True)


def cmd_capabilities(client, args):
    health = client.get('/api/health')
    out({'features': health['features'], 'layer_types': list(health['layer_types']),
         'endpoints': [f"{e['method']} {e['path']}" for e in health['endpoints']]})


def cmd_list(client, args):
    out(client.get('/api/list-layouts', folder=args.folder, phase=args.phase))


def cmd_show(client, args):
    layout = client.get('/api/load-layout', path=args.path)
    if args.layers:
        body = layout.get('layout', layout).get('layers', [])
        out([{k: layer.get(k) for k in ('id', 'type', 'name', 'z')} for layer in body])
        return
    out(layout)


def cmd_patch(client, args):
    out(client.post('/api/patch-layers', {'path': args.path, 'patches': build_patch(args)}))


def cmd_add(client, args):
    """Append a layer to a file: /api/patch-layers only edits existing layers."""
    loaded = client.get('/api/load-layout', path=args.path)
    layout = loaded.get('layout', loaded)
    layer = json.loads(args.json)
    layers = layout.setdefault('layers', [])
    layer.setdefault('id', f"layer_{len(layers)}_{layer.get('type', 'rect')}")
    layer.setdefault('z', max([l.get('z', 0) for l in layers], default=0) + 1)
    layers.append(layer)
    client.post('/api/save-layout', {'path': args.path, 'layout': layout})
    out({'ok': True, 'added': layer['id'], 'layers': len(layers)})


def cmd_live(client, args):
    out(client.get('/api/live/state'))


def cmd_live_patch(client, args):
    payload = {'patches': build_patch(args), 'autosave': not args.no_save}
    try:
        out(client.post('/api/live/patch', payload))
    except ApiError as e:
        if e.status == 409 and args.path:
            print('Nessun editor aperto, ricado sul file.', file=sys.stderr)
            out(client.post('/api/patch-layers', {'path': args.path, 'patches': payload['patches']}))
            return
        raise


def cmd_export(client, args):
    out(client.post('/api/export', {'path': args.path, 'out': args.out}))


def main():
    p = argparse.ArgumentParser(prog='layout_cli', description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--base', default=None, help='URL editor (default env ROBY_LAYOUT_EDITOR_URL)')
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('schema', help='Rigenera docs/LAYOUT-SCHEMA.md (o stampa il catalogo live)')
    s.add_argument('--print', action='store_true', help='Stampa /api/health invece di scrivere il doc')
    s.set_defaults(fn=cmd_schema)

    s = sub.add_parser('capabilities', help='Feature attive e tipi di layer supportati')
    s.set_defaults(fn=cmd_capabilities)

    s = sub.add_parser('list', help='Elenca cartelle e layout')
    s.add_argument('--folder', default=None)
    s.add_argument('--phase', default='all', choices=['folders', 'items', 'all'])
    s.set_defaults(fn=cmd_list)

    s = sub.add_parser('show', help='Stampa un layout')
    s.add_argument('path')
    s.add_argument('--layers', action='store_true', help='Solo id/type/name/z')
    s.set_defaults(fn=cmd_show)

    s = sub.add_parser('patch', help='Modifica layer esistenti su file')
    s.add_argument('path')
    s.add_argument('--set', action='append', metavar='K=V')
    s.add_argument('--json', help='Patch o lista di patch JSON')
    s.set_defaults(fn=cmd_patch)

    s = sub.add_parser('add', help='Aggiunge un layer al file')
    s.add_argument('path')
    s.add_argument('--json', required=True, help='Layer JSON, id e z opzionali')
    s.set_defaults(fn=cmd_add)

    s = sub.add_parser('live', help='Layout attualmente aperto nell editor')
    s.set_defaults(fn=cmd_live)

    s = sub.add_parser('live-patch', help='Modifica in diretta l editor aperto')
    s.add_argument('--set', action='append', metavar='K=V')
    s.add_argument('--json')
    s.add_argument('--path', help='File su cui ricadere se nessun editor e aperto')
    s.add_argument('--no-save', action='store_true', help='Non salvare su disco dopo la patch')
    s.set_defaults(fn=cmd_live_patch)

    s = sub.add_parser('export', help='Render PNG server-side')
    s.add_argument('path')
    s.add_argument('--out', default=None, help='Default: <cartella>/exports/<nome>.png')
    s.set_defaults(fn=cmd_export)

    args = p.parse_args()
    client = LayoutClient(args.base) if args.base else LayoutClient()
    try:
        args.fn(client, args)
    except (ApiError, RuntimeError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
