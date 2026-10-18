# Передача: внедрение анимированного шара в программу ассистента

Этот файл — всё, что нужно новой сессии, чтобы встроить готовую анимацию шара
в программу ассистента (нейросеть «Хайку», подключена через API) и сделать из
неё постоянное приложение на рабочем столе.

## Промпт для новой сессии (вставить целиком)

> Репозиторий `sSadvan/task-server`, ветка `claude/svg-ai-assistant-orb-vwa8z7`, папка `orb/`.
> Прочитай `orb/HANDOFF.md` и `orb/README.md`. Анимация шара уже готова и протестирована,
> её не переделывай. Задача: сделать десктопное приложение (Electron), которое
> 1) запускается автоматически при входе в систему,
> 2) показывает шар справа внизу поверх всех окон, прозрачный, без рамки,
> 3) всё время работает, большую часть времени шар в состоянии `sleeping`,
> 4) просыпается по горячей клавише или клику,
> 5) переключает анимации по событиям программы ассистента «Хайку» (таблица в HANDOFF.md).
> Система: <Windows / macOS / Linux>. Код программы Хайку: <где лежит, на каком языке>.

Перед отправкой промпта подставьте в последней строке систему и место кода.

## Что уже сделано

- **Где лежит:** репозиторий `sSadvan/task-server`, ветка `claude/svg-ai-assistant-orb-vwa8z7`,
  папка `orb/`. Изменения на GitHub отправлены, в `main` пока не слиты.
- **Посмотреть вживую:** https://claude.ai/artifact/3gkFBBejhUsic8zBiWFQ8H
  (страница приватная, видна только владельцу аккаунта).
- **Что готово:**
  - SVG-шар (`orb/assets/orb.svg`);
  - движок анимации (`orb/src/orb-engine.js`);
  - шесть состояний с плавными переходами;
  - панель разработчика (`orb/index.html`);
  - страница голого аватара для Electron (`orb/avatar.html`);
  - браузерные тесты: `node tests/acceptance.mjs`, 17/17 проходят.
- **Чего ещё нет** (это и есть задача):
  - приложения Electron;
  - автозапуска, трея и горячей клавиши;
  - моста событий от программы Хайку к шару.

### Состояния шара

| Состояние | Когда | Вид |
| --- | --- | --- |
| `idle` | ждёт пользователя | синий/голубой, глаза, спокойное дыхание |
| `listening` | слушает пользователя | зелёный, звуковые кольца; реагирует на `setAudioLevel(0..1)` |
| `processing` | думает / работает через Claude Code | малиновый, быстрые ленты, символ `</>` (можно сменить) |
| `memory` | работает с файлами своей памяти | золотой, символ мозга |
| `talking` | отвечает пользователю | как `idle`, слои пульсируют рывками «под голос» (ритм синтетический, звук не нужен) |
| `sleeping` | долгое бездействие / режим ожидания | приглушённый индиго, тусклое свечение, закрытые глаза, медленное дыхание |

## Главное требование: анимация следует за Хайку, а не за Claude Code

Анимацию переключает то, что **делает Хайку**. Claude Code — лишь один из его
инструментов. Предлагаемая привязка (её можно уточнить с пользователем):

| Действие Хайку | Вызов |
| --- | --- |
| ничего не делает | `orb.setState('idle')` |
| нет активности N минут (например, 5) | `orb.setState('sleeping')` |
| получает голос/текст пользователя | `orb.setState('listening')` (+ `setAudioLevel` при живом микрофоне) |
| думает над ответом (запрос к модели идёт, вызовов инструментов ещё нет) | `orb.setState('processing'); orb.setSymbol('network')` |
| вызывает инструмент памяти (чтение/запись файлов памяти) | `orb.setState('memory')` |
| поручает Claude Code исследование | `orb.setState('processing'); orb.setSymbol('network')` |
| поручает Claude Code что-то создать | `orb.setState('processing'); orb.setSymbol('code')` |
| выдаёт ответ пользователю (текст стримится или озвучивается) | `orb.setState('talking')` |
| закончил ответ | `orb.setState('idle')` |

`setSymbol` меняет символ только у текущего состояния. Если нужны два разных вида
processing постоянно, проще зарегистрировать отдельные состояния:

```js
orb.registerState('researching', { interface: { symbol: 'network' } }, { basedOn: 'processing' });
orb.registerState('creating',    { interface: { symbol: 'code' } },    { basedOn: 'processing' });
```

**Синхронность.** Событие надо отправлять в момент, когда Хайку *решил* вызвать
инструмент: это видно в потоке ответа API до начала выполнения. Не после того, как
действие закончено. Шар переключается в том же кадре. Длительность перехода
настраивается (`colorDuration` и др. в `orb.setParameters`). Для быстрых шагов
агента подходят значения 200–300 мс или `{ immediate: true }`. Новый запрос посреди
перехода плавно перенаправляет анимацию, без рывков.

## Мост событий (предложение)

Программа Хайку работает отдельным процессом и, возможно, написана не на JS.
Простейший вариант — локальный WebSocket или HTTP внутри Electron:

- Electron main поднимает `ws://127.0.0.1:<порт>` (или HTTP `POST /state`), слушает
  **только localhost**.
- Программа Хайку шлёт JSON, например:
  - `{"state":"memory"}`
  - `{"state":"processing","symbol":"code"}`
  - `{"audio":0.6}`
- Main пересылает это в окно аватара (`webContents.send` → preload → `window.orb.setState(...)`).
  Либо, проще для старта: `webContents.executeJavaScript("orb.setState('memory')")`.
- Проверять имена состояний: движок сам отклоняет неизвестные (`setState` вернёт `false`).

Со стороны программы Хайку это одна функция `emit(state, symbol=None)`. Её
вызывают в цикле обработки инструментов перед выполнением каждого вызова, при
начале и конце стриминга ответа и при входе пользователя.

## Десктопное приложение: требования и подсказки

- **Окно:**

  ```js
  const { workArea } = screen.getPrimaryDisplay();
  const size = 180, margin = 20;
  const win = new BrowserWindow({
    width: size, height: size,
    x: workArea.x + workArea.width - size - margin,
    y: workArea.y + workArea.height - size - margin,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, backgroundColor: '#00000000',
  });
  win.setAlwaysOnTop(true, 'screen-saver');   // поверх полноэкранных окон
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile('orb/avatar.html');
  ```

- **`file://`:** `avatar.html` загружает SVG через `fetch`. Если в Electron `fetch` по
  `file://` не работает, прочитать `orb/assets/orb.svg` через `fs` и передать текст в
  `OrbEngine.mount(container, { svgText })`. Либо отдавать папку через свой протокол.
- **Клики:**
  - `win.setIgnoreMouseEvents(true, { forward: true })` — клики проходят сквозь шар;
  - для «клик по шару будит» включать захват мыши при наведении (`mouseenter` в preload)
    или использовать только горячую клавишу.
- **Автозапуск:**
  - Windows/macOS: `app.setLoginItemSettings({ openAtLogin: true })`;
  - Linux: файл `.desktop` в `~/.config/autostart/`;
  - срабатывает при входе пользователя, а не до него.
- **Сон без отключения:**
  - приложение живёт в трее весь день (`Tray`: показать/скрыть, панель, выход);
  - при старте и после N минут без событий — `sleeping`;
  - для экономии во сне: `orb.setParameter('maxFps', 15)`, при пробуждении вернуть 60;
  - движок сам останавливает отрисовку, когда окно скрыто.
- **Активация:**
  - `globalShortcut.register('CommandOrControl+Shift+Space', …)` → `idle`/`listening`
    и сигнал программе Хайку «пользователь хочет говорить»;
  - микрофон в шаре **не реализован**, уровень звука передаётся из своей
    аудио-части через `setAudioLevel`.
- **Панель разработчика** (`orb/index.html`) открывать отдельным окном по пункту меню в
  трее. В аватар её не встраивать.
- **Один процесс:** `app.requestSingleInstanceLock()`, чтобы автозапуск не плодил копии.

### Claude Code по запросу Хайку

Держать Claude Code открытым весь день не нужно.
- **Запуск по задаче:** `claude -p "<задача>" --output-format stream-json`.
- **Общий контекст на день:** продолжать разговор через `--resume <session-id>`.
- **Альтернатива:** Claude Agent SDK внутри программы.

Claude Code должен быть один раз авторизован на этом компьютере. Анимацию при этом
переключают события **Хайку** («поручил исследование» / «поручил создание»), а не
внутренние шаги Claude Code.

## API движка (кратко; полностью в README)

```js
import { OrbEngine } from './src/orb-engine.js';
const orb = await OrbEngine.mount(container, { src: 'assets/orb.svg', state: 'sleeping', inactiveFps: 30 });

orb.setState('talking');                       // idle | listening | processing | memory | talking | sleeping
orb.setSymbol('code');                         // eyes | eyes-closed | code | soundwave | brain | network
orb.setParameter('glowIntensity', 0.8);        // правит пресет ТЕКУЩЕГО состояния ({ all: true } — всех)
orb.setParameters({ colorDuration: 250, motionDuration: 250, glowDuration: 250, generalDuration: 250, symbolDuration: 200 });
orb.setAudioLevel(0.6);                        // 0..1, вызывать часто, сам затухает через ~0.6 с
orb.on('statechange', ({ state, previous }) => {});
orb.registerState('researching', {...}, { basedOn: 'processing' });
orb.exportConfig(); orb.loadConfig(json);      // пресеты в JSON (пример: orb/config/default-presets.json)
orb.pause(); orb.resume(); orb.setReducedMotion('auto');
```

## Важные детали и подводные камни

- **Структура папки.** Править вид — в `orb/src/orb-states.js` (пресеты) и
  `orb/src/orb-params.js` (схема параметров). Геометрия SVG генерируется
  `python3 orb/tools/generate_orb.py`; руками `orb.svg` лучше не править, иначе
  генератор перезапишет.
- **`package.json`.** Корневой `package.json` репозитория пустой и ломает Node. У
  `orb/` свой `orb/package.json` (`"type": "module"`). Electron-приложение лучше
  сделать отдельной папкой (например `desktop/`) со своим `package.json`.
- **Тесты:** `cd orb && node tests/acceptance.mjs` (нужен Playwright + Chromium).
  После изменений движка прогонять и держать 17/17.
- **Несколько шаров в одном окне:** `OrbEngine.mount` сам делает id уникальными. При
  ручной вставке SVG — только один шар на документ.
- **Переходы:** каждое состояние может иметь `transitionPace` (sleeping 2.5 — засыпает
  медленно, talking 0.6 — быстро).
- **В облачной сессии:** не использовать `pkill -f <шаблон>` в той же команде, где этот
  шаблон встречается: команда убивает собственную оболочку.

## Открытые вопросы к пользователю

1. Какая ОС: Windows, macOS или Linux?
2. Где код программы Хайку и на каком языке? Как она сейчас вызывает инструменты
   (память, Claude Code)?
3. Как будить ассистента: горячая клавиша (какая?), клик по шару, голосовое слово?
4. Через сколько минут бездействия засыпать?
5. Нужен ли живой микрофон, или достаточно синтетической анимации `talking`?
