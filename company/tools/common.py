"""Общие функции для скриптов компании. Только стандартная библиотека."""
import os
from pathlib import Path

COMPANY_DIR = Path(__file__).resolve().parent.parent


def load_env():
    """Читает company/.env, не перетирая уже заданные переменные окружения."""
    env_file = COMPANY_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Не задан {name}: впиши его в {COMPANY_DIR / '.env'}")
    return value
