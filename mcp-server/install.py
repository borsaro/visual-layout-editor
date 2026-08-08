#!/usr/bin/env python3
"""Registra questo MCP server in un client LLM.

Docker (consigliato) — il server gira nel container, il client si collega via HTTP:

  python3 mcp-server/install.py --url http://192.168.1.20:8766/mcp

Locale — crea venv, installa le dipendenze e usa stdio:

  python3 mcp-server/install.py
  python3 mcp-server/install.py --client claude
  python3 mcp-server/install.py --config /percorso/mcp.json
  python3 mcp-server/install.py --print --url http://host:8766/mcp
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / '.venv-mcp'
SERVER = ROOT / 'mcp-server' / 'server.py'
NAME = 'roby-layout-editor'

CONFIGS = {
    'cursor': Path.home() / '.cursor' / 'mcp.json',
    'claude': Path.home() / '.claude' / 'mcp.json',
}


def build_venv():
    python = VENV / 'bin' / 'python'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(VENV)], check=True)
    print('Installo mcp e httpx…', flush=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r',
                    str(ROOT / 'mcp-server' / 'requirements.txt')], check=True)
    return python


def stdio_entry(python, editor_url):
    return {
        'command': str(python),
        'args': [str(SERVER)],
        'env': {'ROBY_EDITOR_URL': editor_url},
    }


def http_entry(url):
    return {'type': 'http', 'url': url}


def merge(config_path, block):
    """Add the server to an existing mcp.json, keeping every other entry."""
    data = {}
    if config_path.exists():
        shutil.copy(config_path, config_path.with_suffix('.json.bak'))
        data = json.loads(config_path.read_text(encoding='utf-8') or '{}')
    servers = data.setdefault('mcpServers', {})
    replaced = NAME in servers
    servers[NAME] = block
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    return replaced


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--client', choices=sorted(CONFIGS), default='cursor')
    p.add_argument('--config', type=Path, help='mcp.json alternativo')
    p.add_argument('--url', help='MCP già in esecuzione (Docker), es. http://host:8766/mcp')
    p.add_argument('--editor-url', default='http://127.0.0.1:8765',
                   help='Solo modo locale: dove gira l editor')
    p.add_argument('--print', dest='only_print', action='store_true',
                   help='Non tocca nulla, stampa il blocco da incollare')
    args = p.parse_args()

    if args.only_print:
        block = http_entry(args.url) if args.url else stdio_entry(VENV / 'bin' / 'python', args.editor_url)
        print(json.dumps({'mcpServers': {NAME: block}}, indent=2))
        return

    config_path = args.config or CONFIGS[args.client]
    if args.url:
        block = http_entry(args.url)
        note = f'Il server MCP deve essere in ascolto su {args.url} (docker compose up -d).'
    else:
        block = stdio_entry(build_venv(), args.editor_url)
        note = f'Editor atteso su {args.editor_url} — avvialo con ./visual-layout-editor-start.sh'

    replaced = merge(config_path, block)
    print(f"{'Aggiornato' if replaced else 'Aggiunto'} '{NAME}' in {config_path}")
    print(note)
    print('Riavvia il client MCP per vedere i tool.')


if __name__ == '__main__':
    main()
