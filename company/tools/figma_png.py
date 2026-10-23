"""Выгружает фрейм Figma в PNG, чтобы на него можно было посмотреть.

Пример:
  python ../tools/figma_png.py "https://www.figma.com/design/KEY/Name?node-id=12-345" --out work/1/result.png
"""
import argparse
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from common import load_env, require_env


def parse_figma_url(url):
    """Возвращает (file_key, node_id) из ссылки на фрейм."""
    parsed = urllib.parse.urlparse(url)
    m = re.search(r"/(?:design|file|proto|board)/([^/]+)", parsed.path)
    if not m:
        raise SystemExit(f"Не похоже на ссылку Figma: {url}")
    branch = re.search(r"/branch/([^/]+)", parsed.path)
    file_key = branch.group(1) if branch else m.group(1)
    node = urllib.parse.parse_qs(parsed.query).get("node-id", [None])[0]
    if not node:
        raise SystemExit("В ссылке нет node-id — скопируй ссылку на конкретный фрейм (ПКМ → Copy link to selection)")
    return file_key, node.replace("-", ":")


def export_png(url, out, scale=2):
    file_key, node_id = parse_figma_url(url)
    api = (
        f"https://api.figma.com/v1/images/{file_key}?"
        + urllib.parse.urlencode({"ids": node_id, "format": "png", "scale": scale})
    )
    req = urllib.request.Request(api, headers={"X-Figma-Token": require_env("FIGMA_TOKEN")})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    image_url = (data.get("images") or {}).get(node_id)
    if data.get("err") or not image_url:
        raise SystemExit(f"Figma не отдала картинку: {data.get('err') or 'фрейм не найден'}")

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(image_url, timeout=120) as resp:
        out.write_bytes(resp.read())
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("url", help="ссылка на фрейм с node-id")
    p.add_argument("--out", required=True, help="куда сохранить PNG")
    p.add_argument("--scale", type=float, default=2)
    args = p.parse_args()
    load_env()
    print(export_png(args.url, args.out, args.scale))


if __name__ == "__main__":
    main()
