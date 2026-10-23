"""Сдаёт готовую работу: копирует файлы в done/, пишет строку в журнал, шлёт в Telegram.

Пример:
  python ../tools/deliver.py --dept design --task 2026-10-23-01 \
    --summary "Сделано: обложка
  Где: ссылка
  Осталось: ничего" --figma "https://www.figma.com/design/..." work/2026-10-23-01/result.png

Флаг --no-telegram — только done/ и журнал.
"""
import argparse
import json
import mimetypes
import shutil
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from common import COMPANY_DIR, load_env, require_env

PHOTO_EXT = {".png", ".jpg", ".jpeg", ".webp"}
CAPTION_LIMIT = 1024  # ограничение Telegram на подпись


def multipart(fields, files):
    """Собирает multipart/form-data без сторонних библиотек."""
    boundary = uuid.uuid4().hex
    body = bytearray()
    for name, value in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    for name, path in files.items():
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body += (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        body += path.read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def telegram(method, fields, files=None):
    token = require_env("TELEGRAM_BOT_TOKEN")
    body, ctype = multipart(fields, files or {})
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}", data=body, headers={"Content-Type": ctype}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.load(resp)
    if not result.get("ok"):
        raise SystemExit(f"Telegram ответил ошибкой: {result}")


def send_to_telegram(caption, files):
    chat_id = require_env("TELEGRAM_CHAT_ID")
    caption = caption[:CAPTION_LIMIT]
    photos = [f for f in files if f.suffix.lower() in PHOTO_EXT]
    others = [f for f in files if f not in photos]

    if not photos:
        telegram("sendMessage", {"chat_id": chat_id, "text": caption})
    elif len(photos) == 1:
        telegram("sendPhoto", {"chat_id": chat_id, "caption": caption}, {"photo": photos[0]})
    else:
        # альбом: до 10 картинок, подпись у первой
        for start in range(0, len(photos), 10):
            chunk = photos[start:start + 10]
            media = [{"type": "photo", "media": f"attach://p{i}"} for i in range(len(chunk))]
            if start == 0:
                media[0]["caption"] = caption
            telegram(
                "sendMediaGroup",
                {"chat_id": chat_id, "media": json.dumps(media, ensure_ascii=False)},
                {f"p{i}": f for i, f in enumerate(chunk)},
            )
    for f in others:
        telegram("sendDocument", {"chat_id": chat_id}, {"document": f})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dept", required=True, help="отдел: design, montage…")
    p.add_argument("--task", required=True, help="id задачи")
    p.add_argument("--summary", required=True, help="отчёт мастера, 3 строки")
    p.add_argument("--figma", default="", help="ссылка на результат в Figma")
    p.add_argument("--next", default="", help="что запланировано дальше")
    p.add_argument("--no-telegram", action="store_true")
    p.add_argument("files", nargs="*", type=Path)
    args = p.parse_args()
    load_env()

    missing = [str(f) for f in args.files if not f.is_file()]
    if missing:
        raise SystemExit(f"Нет файлов: {', '.join(missing)}")

    done_dir = COMPANY_DIR / "done" / args.dept / args.task
    done_dir.mkdir(parents=True, exist_ok=True)
    delivered = []
    for f in args.files:
        target = done_dir / f.name
        shutil.copy2(f, target)
        delivered.append(target)

    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "dept": args.dept,
        "task": args.task,
        "summary": args.summary,
        "figma": args.figma,
        "files": [str(f.relative_to(COMPANY_DIR)) for f in delivered],
        "next": args.next,
    }
    with open(COMPANY_DIR / "journal.jsonl", "a", encoding="utf-8") as j:
        j.write(json.dumps(entry, ensure_ascii=False) + "\n")

    if not args.no_telegram:
        caption = f"[{args.dept}] {args.task}\n{args.summary}"
        if args.figma:
            caption += f"\n{args.figma}"
        send_to_telegram(caption, delivered)

    print(f"Сдано: {done_dir}")


if __name__ == "__main__":
    main()
