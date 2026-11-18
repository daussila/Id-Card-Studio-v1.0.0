/**
 * The only bridge between the page and the computer's files. Each call is checked again
 * in the main process (electron/main.js and electron/files.js).
 */
'use strict';
const {contextBridge, ipcRenderer} = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke('idcs:' + channel, ...args);

contextBridge.exposeInMainWorld('idcsNative', Object.freeze({
  info: () => invoke('info'),
  readText: rel => invoke('readText', rel),
  writeText: (rel, text) => invoke('writeText', rel, text),
  readBytes: rel => invoke('readBytes', rel),
  writeBytes: (rel, bytes) => invoke('writeBytes', rel, bytes),
  list: rel => invoke('list', rel),
  ensureDir: rel => invoke('ensureDir', rel),
  exists: rel => invoke('exists', rel),
  moveFile: (from, to) => invoke('moveFile', from, to),
  remove: rel => invoke('remove', rel),
  readSource: file => invoke('readSource', file),
  writeSource: (file, bytes) => invoke('writeSource', file, bytes),
  pickCsv: () => invoke('pickCsv'),
  openData: rel => invoke('openData', rel),
  openSource: file => invoke('openSource', file)
}));
