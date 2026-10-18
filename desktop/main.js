'use strict';
// John's orb: a transparent always-on-top avatar in the bottom-right corner.
// Lives in the tray all day, sleeps when idle, and follows events from John via the local bridge.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, protocol, net, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createBridge } = require('./bridge-server');

const ROOT = path.resolve(__dirname, '..');          // repo root: serves orb/ and desktop/
const SERVED = ['orb', 'desktop'];
const PORT = Number(process.env.JOHN_ORB_PORT) || 47821;
const SLEEP_AFTER_MIN = Number(process.env.JOHN_ORB_SLEEP_MIN) || 5;
const HOTKEY = process.env.JOHN_ORB_HOTKEY || 'CommandOrControl+Shift+Space';
const SIZE = 180;
const MARGIN = 20;
const FPS_AWAKE = 60;
const FPS_ASLEEP = 15;

if (!app.requestSingleInstanceLock()) app.exit(0);

// ES modules and fetch() need a real scheme; file:// blocks them.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let studio = null;
let tray = null;
let bridge = null;
let state = 'sleeping';
let lastEvent = Date.now();

function sendToOrb(cmd) {
  if (cmd.state) {
    if (cmd.state !== state) cmd.fps = cmd.state === 'sleeping' ? FPS_ASLEEP : FPS_AWAKE;
    state = cmd.state;
  }
  if (cmd.state !== 'sleeping') lastEvent = Date.now();
  win?.webContents.send('orb', cmd);
}

function wake() {
  sendToOrb({ state: 'listening', immediate: true });
  bridge?.request('wake');
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: SIZE, height: SIZE,
    x: workArea.x + workArea.width - SIZE - MARGIN,
    y: workArea.y + workArea.height - SIZE - MARGIN,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(`app://john/desktop/avatar.html?state=${state}&fps=${FPS_ASLEEP}`);
  win.on('closed', () => { win = null; });
}

function openStudio() {
  if (studio) return studio.focus();
  studio = new BrowserWindow({ width: 1200, height: 800, title: 'Orb Studio' });
  studio.loadURL('app://john/orb/index.html');
  studio.on('closed', () => { studio = null; });
}

// --- Autostart -------------------------------------------------------------

const linuxAutostartFile = path.join(os.homedir(), '.config', 'autostart', 'john-orb.desktop');

function launchCommand() {
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  return app.isPackaged ? q(process.execPath) : `${q(process.execPath)} ${q(app.getAppPath())}`;
}

function getAutostart() {
  if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile);
  return app.getLoginItemSettings().openAtLogin;
}

function setAutostart(on) {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: on, args: app.isPackaged ? [] : [app.getAppPath()] });
    return;
  }
  if (!on) return fs.rmSync(linuxAutostartFile, { force: true });
  fs.mkdirSync(path.dirname(linuxAutostartFile), { recursive: true });
  fs.writeFileSync(linuxAutostartFile, [
    '[Desktop Entry]', 'Type=Application', 'Name=John Orb', `Exec=${launchCommand()}`,
    'X-GNOME-Autostart-enabled=true', 'NoDisplay=true', '',
  ].join('\n'));
}

// --- Tray ------------------------------------------------------------------

function buildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать / скрыть шар', click: () => (win?.isVisible() ? win.hide() : win?.showInactive()) },
    { label: 'Разбудить', click: wake },
    { label: 'Уснуть', click: () => sendToOrb({ state: 'sleeping' }) },
    { type: 'separator' },
    { label: 'Запускать при входе', type: 'checkbox', checked: getAutostart(),
      click: (item) => { setAutostart(item.checked); buildTrayMenu(); } },
    { label: 'Панель разработчика', click: openStudio },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]));
}

// --- App -------------------------------------------------------------------

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    const allowed = SERVED.some((dir) => file.startsWith(path.join(ROOT, dir) + path.sep));
    if (!allowed) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Джон');
  tray.on('click', wake);
  buildTrayMenu();

  if (!globalShortcut.register(HOTKEY, wake)) console.warn(`[orb] hotkey ${HOTKEY} is taken`);

  ipcMain.on('click-through', (_e, on) => win?.setIgnoreMouseEvents(!!on, { forward: true }));
  ipcMain.on('wake', wake);

  bridge = createBridge({ port: PORT, onCommand: sendToOrb, getState: () => state });
  try {
    await bridge.listen();
    console.log(`[orb] bridge on http://127.0.0.1:${PORT}`);
  } catch (err) {
    console.error(`[orb] bridge failed on port ${PORT}: ${err.message}`);
  }

  // Fallback sleep: John normally says "sleeping" himself.
  setInterval(() => {
    if (state !== 'sleeping' && Date.now() - lastEvent > SLEEP_AFTER_MIN * 60_000) sendToOrb({ state: 'sleeping' });
  }, 15_000);
});

app.on('second-instance', () => win?.showInactive());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});   // keep living in the tray
