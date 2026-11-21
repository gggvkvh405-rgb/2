/* ============================================================
   ByAzen Desktop — Electron main process
   Loads the local app, keeps data on disk, adds desktop niceties.
   ============================================================ */
const { app, BrowserWindow, Menu, shell, session, nativeTheme, ipcMain } = require('electron');
const path = require('path');

nativeTheme.themeSource = 'dark';

const APP_DIR = path.join(__dirname, '..', 'app');
const isMac = process.platform === 'darwin';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#060709',
    title: 'ByAzen',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(APP_DIR, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (isMac) win.setWindowButtonPosition({ x: 14, y: 18 });
  });

  // external links open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => (win = null));
}

// microphone + notifications for the local app
ipcMain.handle("noop", () => true);
function grantPermissions() {
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
}

const template = [
  ...(isMac
    ? [{
        label: 'ByAzen',
        submenu: [
          { role: 'about', label: 'О ByAzen' },
          { type: 'separator' },
          { role: 'hide', label: 'Скрыть' },
          { role: 'hideOthers', label: 'Скрыть остальные' },
          { role: 'unhide', label: 'Показать все' },
          { type: 'separator' },
          { role: 'quit', label: 'Завершить' },
        ],
      }]
    : []),
  {
    label: 'Файл',
    submenu: [
      { role: 'reload', label: 'Обновить' },
      { role: 'forceReload', label: 'Перезагрузить принудительно' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'Закрыть окно' } : { role: 'quit', label: 'Выход' },
    ],
  },
  {
    label: 'Правка',
    submenu: [
      { role: 'undo', label: 'Отменить' },
      { role: 'redo', label: 'Повторить' },
      { type: 'separator' },
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выбрать всё' },
    ],
  },
  {
    label: 'Вид',
    submenu: [
      { role: 'resetZoom', label: 'Масштаб 100%' },
      { role: 'zoomIn', label: 'Увеличить' },
      { role: 'zoomOut', label: 'Уменьшить' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Полный экран' },
    ],
  },
  {
    label: 'Справка',
    submenu: [
      {
        label: 'ByAzen — тишина между словами',
        click: () => shell.openExternal('https://example.com/byazen'),
      },
    ],
  },
];

app.whenReady().then(() => {
  grantPermissions();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
