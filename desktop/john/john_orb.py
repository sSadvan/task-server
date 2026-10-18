"""Мост Джон -> шар на рабочем столе.

Отправляет приложению шара (desktop/, Electron) только имя состояния, символ и
уровень звука. Текст фраз сюда не попадает никогда.

Все вызовы неблокирующие: события уходят в фоновом потоке, а если шар не
запущен, они молча теряются. Джон от этого не падает и не тормозит.

    import john_orb as orb
    orb.sleeping()          # Джон уснул
    orb.awake()             # услышал «Джон»
    orb.listening()         # слушает пользователя; orb.audio(rms) из микрофона
    orb.thinking()          # запрос к Хайку ушёл
    orb.tool("memory")      # Хайку решил вызвать инструмент (до его выполнения)
    orb.talking()           # начал отвечать / озвучивать
    orb.idle()              # закончил ответ
    if orb.wake_requested(): ...   # пользователь нажал горячую клавишу или кликнул по шару
"""

import json
import os
import queue
import threading
import time
import urllib.request

URL = os.environ.get("JOHN_ORB_URL", "http://127.0.0.1:47821")
TIMEOUT = 0.3
AUDIO_INTERVAL = 0.05  # не чаще 20 раз в секунду

# Инструмент Хайку -> (состояние, символ). Ключ ищется в имени инструмента.
TOOL_STATES = {
    "memory": ("memory", None),
    "research": ("processing", "network"),
    "search": ("processing", "network"),
    "create": ("processing", "code"),
    "code": ("processing", "code"),
    "claude": ("processing", "code"),
}

# Шар всегда на этой машине: системный прокси (HTTP_PROXY) обходим.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_queue = queue.Queue(maxsize=64)
_last_audio = 0.0
_worker = None
_lock = threading.Lock()


def _post(payload):
    req = urllib.request.Request(
        URL + "/event",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with _opener.open(req, timeout=TIMEOUT):
        pass


def _run():
    while True:
        payload = _queue.get()
        try:
            _post(payload)
        except Exception:
            pass  # шар не запущен или занят: не важно
        finally:
            _queue.task_done()


def _send(payload):
    global _worker
    with _lock:
        if _worker is None:
            _worker = threading.Thread(target=_run, name="john-orb", daemon=True)
            _worker.start()
    try:
        _queue.put_nowait(payload)
    except queue.Full:
        pass


def emit(state, symbol=None, immediate=False):
    payload = {"state": state}
    if symbol:
        payload["symbol"] = symbol
    if immediate:
        payload["immediate"] = True
    _send(payload)


def audio(level):
    """Уровень микрофона 0..1. Можно звать на каждый аудиокадр, лишнее отбрасывается."""
    global _last_audio
    now = time.monotonic()
    if now - _last_audio < AUDIO_INTERVAL:
        return
    _last_audio = now
    _send({"audio": max(0.0, min(1.0, float(level)))})


def sleeping():
    emit("sleeping")


def awake():
    emit("listening", immediate=True)


def listening():
    emit("listening")


def thinking():
    emit("processing", "network")


def tool(name):
    """Вызывать, когда Хайку решил вызвать инструмент, до начала выполнения."""
    lowered = (name or "").lower()
    for key, (state, symbol) in TOOL_STATES.items():
        if key in lowered:
            return emit(state, symbol)
    emit("processing", "network")


def talking():
    emit("talking")


def idle():
    emit("idle")


def wake_requested():
    """True, если с момента прошлой проверки нажали горячую клавишу или кликнули по шару."""
    try:
        with _opener.open(URL + "/poll", timeout=TIMEOUT) as res:
            return "wake" in json.load(res).get("requests", [])
    except Exception:
        return False


def wait_sent(timeout=2.0):
    """Дождаться отправки очереди (для тестов и выхода из программы)."""
    end = time.monotonic() + timeout
    while _queue.unfinished_tasks and time.monotonic() < end:
        time.sleep(0.01)
