#!/usr/bin/env python3
"""Render docs/LAYOUT-SCHEMA.md from api_catalog.py, the single source of truth.

Run after touching api_catalog.py:  python3 scripts/gen_schema_doc.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api_catalog as cat  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'LAYOUT-SCHEMA.md'


def esc(text):
    """Pipes would split a markdown table cell."""
    return str(text).replace('|', '\\|')


def field_row(name, spec, extra=''):
    """One markdown table row for a field, folding enum/default into the notes."""
    notes = []
    if 'enum' in spec:
        notes.append('uno di: ' + ', '.join(f'`{v}`' for v in spec['enum']))
    if 'default' in spec:
        notes.append('default `' + json.dumps(spec['default']) + '`')
    if extra:
        notes.append(extra)
    tail = f" _({'; '.join(notes)})_" if notes else ''
    return f"| `{name}` | {spec.get('type', '-')} | {esc(spec.get('desc', ''))}{tail} |"


def field_table(names, extra_by_name=None):
    extra_by_name = extra_by_name or {}
    lines = ['| Campo | Tipo | Descrizione |', '| --- | --- | --- |']
    for n in names:
        spec = cat.LAYER_FIELDS_FOR_AGENTS.get(n, {})
        lines.append(field_row(n, spec, extra_by_name.get(n, '')))
    return lines


def section_root():
    lines = ['## File `.layout.json`', '', '```json',
             json.dumps({'canvas': cat.LAYOUT_ROOT['canvas']['default'],
                         'layers': [{'id': 'bg', 'type': 'rect', 'x': 0, 'y': 0,
                                     'w': 1080, 'h': 1350, 'z': 0, 'fill': '#101010'}]},
                        indent=2, ensure_ascii=False),
             '```', '']
    lines += ['| Chiave | Tipo | Descrizione |', '| --- | --- | --- |']
    for name, spec in cat.LAYOUT_ROOT.items():
        lines.append(f"| `{name}` | {spec['type']} | {esc(spec['desc'])} |")
    return lines + ['']


def section_common():
    return (['## Campi comuni a ogni layer', '']
            + field_table(cat.COMMON_LAYER_FIELDS) + [''])


def section_types():
    lines = ['## Tipi di layer', '']
    for name, info in cat.LAYER_TYPES.items():
        lines += [f'### `type: "{name}"`', '', info['desc'], '']
        lines += field_table(info['fields'])
        if name == 'shape':
            lines += ['', 'Preset `shapeKind`: '
                      + ', '.join(f'`{k}`' for k in cat.SHAPE_KINDS) + '.']
        lines.append('')
    return lines


def section_recipes():
    lines = ['## Ricette per agenti', '']
    for name, rec in cat.health_payload('-', '-', False)['agent'].items():
        lines += [f'### {name}', '']
        for k, v in rec.items():
            val = v if isinstance(v, str) else '`' + json.dumps(v, ensure_ascii=False) + '`'
            lines.append(f'- **{k}**: {val}')
        lines.append('')
    return lines


def section_endpoints():
    lines = ['## Endpoint HTTP', '', '| Metodo | Path | Descrizione |', '| --- | --- | --- |']
    for e in cat.ENDPOINTS:
        lines.append(f"| `{e['method']}` | `{e['path']}` | {esc(e['desc'])} |")
    return lines + ['']


def build():
    head = [
        '# Schema layout — riferimento per agenti',
        '',
        '> Generato da `scripts/gen_schema_doc.py` a partire da `scripts/api_catalog.py`.',
        '> Non modificarlo a mano: cambia il catalogo e rilancia lo script.',
        '',
        'Tre modi per produrre un layout, tutti equivalenti sullo stesso schema:',
        '',
        '1. **Scrivere il JSON a mano** nella root campagne (metodo storico, sempre valido).',
        '2. **CLI**: `python3 scripts/layout_cli.py --help` (schema, patch, add, export, live).',
        '3. **MCP**: server in `mcp-server/`, espone gli stessi comandi come tool.',
        '',
        'Esempio che usa tutte le funzionalità: `examples/feature-reference.layout.json`.',
        '',
    ]
    body = section_root() + section_common() + section_types() + section_recipes() + section_endpoints()
    return '\n'.join(head + body).rstrip() + '\n'


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build(), encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)}')
