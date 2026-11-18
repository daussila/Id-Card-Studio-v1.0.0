/**
 * ID Card Studio for Windows and Mac — Electron main process.
 *
 * Where files are kept:
 *  - Installed version (Windows and Mac): Documents/ID Card Studio
 *  - Windows portable version: "ID Card Studio Data" next to the .exe (everything travels with it)
 */
'use strict';
const {app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, session, systemPreferences} = require('electron');
const fs = require('fs');
const path = require('path');
const {createFiles} = require('./files');

const APP_DIR = path.join(__dirname, '..', 'app');
const IS_MAC = process.platform === 'darwin';
const SAMPLE_NAME = 'Sample Students.csv';
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
if (PORTABLE_DIR) app.setPath('userData', path.join(PORTABLE_DIR, 'ID Card Studio Data', '.app'));
/** Looked up after start-up, when Windows folder locations are available. */
const dataRoot = () => PORTABLE_DIR
  ? path.join(PORTABLE_DIR, 'ID Card Studio Data')
  : path.join(app.getPath('documents'), 'ID Card Studio');

// The app's pages are served from app://studio/ — a secure origin, so the camera, storage and
// printing work exactly as in a browser.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

let mainWindow = null;
let files = null;

function serveAppFiles() {
  protocol.handle('app', async request => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname);
    if (!relative || relative === '/') relative = '/index.html';
    const target = path.normalize(path.join(APP_DIR, relative));
    if (!target.startsWith(APP_DIR + path.sep)) return new Response('Not found', {status: 404});
    try {
      const body = await fs.promises.readFile(target);
      return new Response(body, {headers: {'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream'}});
    } catch (error) {
      return new Response('Not found', {status: 404});
    }
  });
}

/** Every request from the page is checked here; paths can never leave the data folder. */
function registerFileAccess() {
  const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Not allowed.');
    return action(...args);
  });
  handle('idcs:info', async () => ({dataRoot: files.root, sep: path.sep, mac: IS_MAC, portable: Boolean(PORTABLE_DIR), version: app.getVersion()}));
  handle('idcs:readText', rel => files.readText(rel));
  handle('idcs:writeText', (rel, text) => files.writeText(rel, text));
  handle('idcs:readBytes', rel => files.readBytes(rel));
  handle('idcs:writeBytes', (rel, bytes) => files.writeBytes(rel, bytes));
  handle('idcs:list', rel => files.list(rel));
  handle('idcs:ensureDir', rel => files.ensureDir(rel));
  handle('idcs:exists', rel => files.exists(rel));
  handle('idcs:moveFile', (from, to) => files.moveFile(from, to));
  handle('idcs:remove', rel => files.remove(rel));
  handle('idcs:readSource', file => files.readSource(file));
  handle('idcs:writeSource', (file, bytes) => files.writeSource(file, bytes));
  handle('idcs:pickCsv', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the CSV file for this list',
      defaultPath: path.join(files.root, 'Data'),
      filters: [{name: 'CSV files', extensions: ['csv']}],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    // A file from anywhere else is copied into the Data folder; the list uses that copy.
    const imported = await files.importCsv(result.filePaths[0]);
    await files.allow(imported.path);
    return {path: imported.path, name: path.basename(imported.path), copied: imported.copied, from: path.basename(result.filePaths[0])};
  });
  handle('idcs:openData', async rel => {
    const target = rel ? files.inside(rel) : files.root;
    await fs.promises.mkdir(target, {recursive: true});
    const problem = await shell.openPath(target);
    if (problem) throw new Error(problem);
  });
  handle('idcs:openSource', async file => {
    const problem = await shell.openPath(await files.source(file));
    if (problem) throw new Error(problem);
  });
}

function showAbout() {
  return dialog.showMessageBox(mainWindow, {
    type: 'info', title: 'About ID Card Studio', message: 'ID Card Studio',
    detail: ['Version ' + app.getVersion(), 'Created by Mahmut Ziyanoglu', 'Copyright © 2026'].join('\n')
  });
}

/** The first time the app starts, a sample CSV is put in the Data folder to try things out. */
async function addSampleOnce() {
  const marker = path.join(app.getPath('userData'), 'sample-added');
  if (fs.existsSync(marker)) return;
  const target = path.join(files.root, 'Data', SAMPLE_NAME);
  try {
    if (!fs.existsSync(target)) await fs.promises.copyFile(path.join(__dirname, '..', 'sample', SAMPLE_NAME), target);
    await fs.promises.mkdir(path.dirname(marker), {recursive: true});
    await fs.promises.writeFile(marker, new Date().toISOString());
  } catch (error) { /* not important enough to stop the app */ }
}

function buildMenu() {
  // On a Mac the first menu is the app menu, and the Edit menu makes ⌘C / ⌘V / ⌘Z work in text boxes.
  const macMenus = IS_MAC ? [
    {label: app.name, submenu: [
      {label: 'About ID Card Studio', click: showAbout},
      {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'},
      {type: 'separator'},
      {role: 'quit'}
    ]}
  ] : [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...macMenus,
    {label: 'File', submenu: [
      {label: 'Open ID Card Studio Folder', click: () => shell.openPath(files.root)},
      {type: 'separator'},
      {label: 'Open Data Folder', click: () => shell.openPath(path.join(files.root, 'Data'))},
      {label: 'Open Designs Folder', click: () => shell.openPath(path.join(files.root, 'Designs'))},
      {label: 'Open Photos Folder', click: () => shell.openPath(path.join(files.root, 'Photos'))},
      ...(IS_MAC ? [{type: 'separator'}, {role: 'close'}] : [{type: 'separator'}, {role: 'quit', label: 'Exit'}])
    ]},
    ...(IS_MAC ? [{role: 'editMenu'}] : []),
    {label: 'View', submenu: [
      {role: 'reload', label: 'Reload'},
      {type: 'separator'},
      {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'},
      {type: 'separator'},
      {role: 'togglefullscreen'},
      {role: 'toggleDevTools', label: 'Developer Tools'}
    ]},
    ...(IS_MAC ? [{role: 'windowMenu'}] : [{label: 'Help', submenu: [
      {label: 'About ID Card Studio', click: showAbout}
    ]}])
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    show: false, backgroundColor: '#e9eef5', title: 'ID Card Studio',
    icon: path.join(APP_DIR, 'icons', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true
    }
  });
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });

  // The camera and print preview open as small windows from the page (about:blank).
  const popupHandler = ({url}) => {
    if (url === 'about:blank' || url === '') {
      return {action: 'allow', overrideBrowserWindowOptions: {autoHideMenuBar: true, backgroundColor: '#ffffff', icon: path.join(APP_DIR, 'icons', 'icon-256.png')}};
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return {action: 'deny'};
  };
  mainWindow.webContents.setWindowOpenHandler(popupHandler);
  mainWindow.webContents.on('did-create-window', child => child.webContents.setWindowOpenHandler(popupHandler));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  // Unsaved designs: ask before closing.
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Unsaved changes', message: 'A design has unsaved changes.', detail: 'Close ID Card Studio anyway?'
    });
    if (choice === 0) event.preventDefault();
  });
  mainWindow.loadURL('app://studio/index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    files = createFiles(dataRoot(), path.join(app.getPath('userData'), 'allowed-files.json'));
    await files.ensureRoot();
    await addSampleOnce();
    // The camera is the only device permission the app needs.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      const ok = ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
      // A Mac asks the person once whether ID Card Studio may use the camera.
      if (ok && permission === 'media' && IS_MAC) {
        systemPreferences.askForMediaAccess('camera').then(callback, () => callback(false));
        return;
      }
      callback(ok);
    });
    serveAppFiles();
    registerFileAccess();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
