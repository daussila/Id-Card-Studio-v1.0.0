/**
 * Storage for ID Card Studio: one interface, two versions.
 *  - Desktop (Windows and Mac apps): files through Electron (window.idcsNative).
 *  - Browser (installed from Edge or Chrome): the File System Access API on a folder the
 *    person chooses once. Nothing leaves the computer.
 *
 * Paths inside the data folder use "/" (e.g. "Photos/Students/102345.jpg").
 * A CSV source is identified by a token:
 *   desktop  "path:C:\…\Students.csv"
 *   browser  "data:Students.csv" (inside the data folder) or "handle:<id>" (elsewhere)
 */
(function (global) {
  'use strict';

  const IMAGE_TYPES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp'};
  const mimeFor = name => IMAGE_TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
  const baseName = path => String(path).split(/[\\/]/).pop();

  function bytesToDataUrl(bytes, mime) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    return 'data:' + mime + ';base64,' + btoa(binary);
  }
  function dataUrlToBytes(dataUrl) {
    const binary = atob(String(dataUrl).split(',')[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function checkRelative(rel) {
    const parts = String(rel || '').split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))) {
      throw new Error('Invalid file location: ' + rel);
    }
    return parts;
  }
  /** Friendly message for a file another program is using. */
  function busyError(name) {
    return new Error('“' + name + '” is open in another program (for example Excel). Close it there, then try again.');
  }

  // ===================================================================== Desktop
  function desktopPlatform(native) {
    let info = null;
    return {
      kind: 'desktop',
      canOpenFiles: true,
      async init() {
        info = await native.info();
        for (const name of ['Data', 'Designs', 'Photos']) await native.ensureDir(name);
        return {ready: true};
      },
      get dataLabel() { return info ? info.dataRoot : ''; },
      get dataSeparator() { return (info && info.sep) || '\\'; },
      readText: rel => native.readText(checkRelative(rel).join('/')),
      writeText: (rel, text) => native.writeText(checkRelative(rel).join('/'), text),
      async readBytes(rel) { return new Uint8Array(await native.readBytes(checkRelative(rel).join('/'))); },
      writeBytes: (rel, bytes) => native.writeBytes(checkRelative(rel).join('/'), bytes),
      list: rel => native.list(checkRelative(rel).join('/')),
      ensureDir: rel => native.ensureDir(checkRelative(rel).join('/')),
      exists: rel => native.exists(checkRelative(rel).join('/')),
      moveFile: (from, to) => native.moveFile(checkRelative(from).join('/'), checkRelative(to).join('/')),
      remove: rel => native.remove(checkRelative(rel).join('/')),
      async pickCsv() {
        const picked = await native.pickCsv();
        if (!picked) return null;
        const token = picked.relative ? 'data:' + picked.relative : 'path:' + picked.path;
        return {token, name: picked.name, copied: Boolean(picked.copied), from: picked.from || picked.name};
      },
      /**
       * CSV files inside the data folder are remembered by their place in it ("data:Data/Students.csv"),
       * so computers sharing the folder (OneDrive, Google Drive, network drive) all find them.
       * Older lists remembered the full path; this turns those into the shared form.
       */
      async portableToken(token) {
        token = String(token || '');
        if (!token.startsWith('path:')) return token;
        const full = token.slice(5).replace(/\\/g, '/');
        const root = String(info.dataRoot).replace(/\\/g, '/').replace(/\/+$/, '');
        if (full.toLowerCase().startsWith(root.toLowerCase() + '/')) return 'data:' + full.slice(root.length + 1);
        // A path from another computer's ID Card Studio folder: look for the same file here.
        const marker = full.toLowerCase().lastIndexOf('/id card studio/');
        if (marker >= 0) {
          const rest = full.slice(marker + '/id card studio/'.length);
          if (rest && await native.exists(rest).catch(() => false)) return 'data:' + rest;
        }
        return token;
      },
      async sourceName(token) { return baseName(String(token).replace(/^(path|data):/, '')); },
      async sourceLocation(token) {
        token = String(token);
        if (token.startsWith('data:')) return info.dataRoot + (info.sep || '\\') + token.slice(5).split('/').join(info.sep || '\\');
        return token.replace(/^path:/, '');
      },
      async readSource(token) {
        token = String(token);
        if (token.startsWith('data:')) {
          if (!(await native.exists(checkRelative(token.slice(5)).join('/')))) {
            throw new Error('The CSV file “' + baseName(token.slice(5)) + '” is not in the Data folder. If the folder is shared, wait for it to finish syncing, or choose the file again in ⚙ Settings.');
          }
          return new Uint8Array(await native.readBytes(checkRelative(token.slice(5)).join('/')));
        }
        return new Uint8Array(await native.readSource(token.replace(/^path:/, '')));
      },
      writeSource: (token, bytes) => String(token).startsWith('data:')
        ? native.writeBytes(checkRelative(String(token).slice(5)).join('/'), bytes)
        : native.writeSource(String(token).replace(/^path:/, ''), bytes),
      openData: rel => native.openData(rel ? checkRelative(rel).join('/') : ''),
      openSource: token => String(token).startsWith('data:')
        ? native.openData(checkRelative(String(token).slice(5)).join('/'))
        : native.openSource(String(token).replace(/^path:/, '')),
      pendingPermissions: async () => [],
      chooseFolder: async () => { await native.openData(''); return {ready: true}; }
    };
  }

  // ===================================================================== Browser
  function browserPlatform() {
    const DB_NAME = 'idcs-folder-access';
    let root = null;

    function db() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    async function idb(mode, action) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const store = database.transaction('handles', mode).objectStore('handles');
        const request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).finally(() => database.close());
    }
    const getHandle = key => idb('readonly', store => store.get(key));
    const putHandle = (key, value) => idb('readwrite', store => store.put(value, key));
    const allKeys = () => idb('readonly', store => store.getAllKeys());

    async function permitted(handle, ask) {
      const options = {mode: 'readwrite'};
      if ((await handle.queryPermission(options)) === 'granted') return true;
      return ask ? (await handle.requestPermission(options)) === 'granted' : false;
    }
    async function dir(parts, create) {
      let current = root;
      for (const part of parts) current = await current.getDirectoryHandle(part, {create: Boolean(create)});
      return current;
    }
    async function file(rel, create) {
      const parts = checkRelative(rel);
      const folder = await dir(parts.slice(0, -1), create);
      return folder.getFileHandle(parts[parts.length - 1], {create: Boolean(create)});
    }
    async function writeHandle(handle, data) {
      let writable;
      try {
        writable = await handle.createWritable();
      } catch (error) {
        if (error && /NoModificationAllowed|InvalidState/i.test(error.name)) throw busyError(handle.name);
        throw error;
      }
      await writable.write(data);
      await writable.close();
    }
    const missing = error => error && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError');
    async function prepare() {
      for (const name of ['Data', 'Designs', 'Photos']) await root.getDirectoryHandle(name, {create: true});
    }

    return {
      kind: 'browser',
      canOpenFiles: false,
      supported: typeof global.showDirectoryPicker === 'function',
      /** {ready} or {ready:false, reason:'unsupported'|'choose'|'permission', folderName}. */
      async init() {
        if (typeof global.showDirectoryPicker !== 'function') return {ready: false, reason: 'unsupported'};
        root = await getHandle('root').catch(() => null);
        if (!root) return {ready: false, reason: 'choose'};
        if (!(await permitted(root, false))) return {ready: false, reason: 'permission', folderName: root.name};
        await prepare();
        return {ready: true};
      },
      /** Must run inside a click. */
      async chooseFolder() {
        const picked = await global.showDirectoryPicker({id: 'idcs-data', mode: 'readwrite', startIn: 'documents'});
        if (!(await permitted(picked, true))) throw new Error('ID Card Studio needs permission to save files in that folder.');
        root = picked;
        await putHandle('root', picked);
        await prepare();
        return {ready: true};
      },
      /** Must run inside a click. */
      async allowAgain() {
        if (!root) root = await getHandle('root');
        if (!(await permitted(root, true))) throw new Error('Permission was not given. Click “Continue” and choose “Allow”.');
        await prepare();
        return {ready: true};
      },
      get dataLabel() { return root ? root.name : ''; },
      get dataSeparator() { return '\\'; },
      async readText(rel) {
        try { return await (await (await file(rel)).getFile()).text(); } catch (error) { if (missing(error)) return null; throw error; }
      },
      writeText: async (rel, text) => writeHandle(await file(rel, true), text),
      async readBytes(rel) { return new Uint8Array(await (await (await file(rel)).getFile()).arrayBuffer()); },
      writeBytes: async (rel, bytes) => writeHandle(await file(rel, true), bytes),
      async list(rel) {
        let folder;
        try { folder = await dir(checkRelative(rel)); } catch (error) { if (missing(error)) return []; throw error; }
        const output = [];
        for await (const handle of folder.values()) {
          if (handle.kind === 'directory') { output.push({name: handle.name, kind: 'dir'}); continue; }
          const f = await handle.getFile();
          output.push({name: handle.name, kind: 'file', size: f.size, modified: f.lastModified});
        }
        return output;
      },
      ensureDir: async rel => { await dir(checkRelative(rel), true); },
      async exists(rel) {
        try { await file(rel); return true; } catch (error) { if (missing(error)) return false; throw error; }
      },
      async moveFile(from, to) {
        const bytes = await this.readBytes(from);
        await this.writeBytes(to, bytes);
        await this.remove(from);
      },
      async remove(rel) {
        const parts = checkRelative(rel);
        try { await (await dir(parts.slice(0, -1))).removeEntry(parts[parts.length - 1]); } catch (error) { if (!missing(error)) throw error; }
      },
      /** Must run inside a click. CSV files inside the data folder need no extra permission. */
      async pickCsv() {
        let handles;
        try {
          handles = await global.showOpenFilePicker({
            id: 'idcs-csv', startIn: root,
            types: [{description: 'CSV file', accept: {'text/csv': ['.csv']}}], multiple: false
          });
        } catch (error) {
          if (error && error.name === 'AbortError') return null;
          throw error;
        }
        const handle = handles[0];
        const inside = await root.resolve(handle);
        if (inside) return {token: 'data:' + inside.join('/'), name: handle.name};
        if (!(await permitted(handle, true))) throw new Error('ID Card Studio needs permission to save changes into ' + handle.name + '.');
        const id = 'src_' + crypto.randomUUID();
        await putHandle(id, handle);
        return {token: 'handle:' + id, name: handle.name};
      },
      async sourceName(token) {
        token = String(token);
        if (token.startsWith('data:')) return baseName(token.slice(5));
        const handle = await getHandle(token.slice(7)).catch(() => null);
        return handle ? handle.name : 'CSV file';
      },
      async sourceLocation(token) {
        token = String(token);
        return token.startsWith('data:') ? root.name + '\\' + token.slice(5).split('/').join('\\') : await this.sourceName(token);
      },
      async sourceHandle(token) {
        token = String(token);
        if (token.startsWith('data:')) return file(token.slice(5));
        const handle = await getHandle(token.slice(7));
        if (!handle) throw new Error('This list’s CSV file is no longer available. Choose it again in ⚙ Settings.');
        if (!(await permitted(handle, false))) {
          throw new Error('ID Card Studio needs your OK to open ' + handle.name + '. Reload the app and click “Allow” next to it.');
        }
        return handle;
      },
      async readSource(token) {
        try {
          return new Uint8Array(await (await (await this.sourceHandle(token)).getFile()).arrayBuffer());
        } catch (error) {
          if (missing(error)) throw new Error('The CSV file was moved or deleted. Choose it again in ⚙ Settings.');
          throw error;
        }
      },
      writeSource: async function (token, bytes) { await writeHandle(await this.sourceHandle(token), bytes); },
      openData: async () => false,
      openSource: async () => false,
      portableToken: async token => String(token || ''),
      /** CSV files outside the data folder whose permission must be confirmed with a click. */
      async pendingPermissions() {
        const keys = (await allKeys()).filter(key => String(key).startsWith('src_'));
        const pending = [];
        for (const key of keys) {
          const handle = await getHandle(key);
          if (handle && !(await permitted(handle, false))) pending.push({token: 'handle:' + key, name: handle.name});
        }
        return pending;
      },
      /** Must run inside a click. */
      async allowSource(token) {
        const handle = await getHandle(String(token).slice(7));
        return Boolean(handle) && permitted(handle, true);
      },
      /** For automated tests: use a given directory handle (e.g. the browser's private storage). */
      async useFolderForTesting(handle) {
        root = handle;
        await putHandle('root', handle);
        await prepare();
      }
    };
  }

  global.IDCSPlatform = Object.freeze({
    create: () => global.idcsNative ? desktopPlatform(global.idcsNative) : browserPlatform(),
    mimeFor, bytesToDataUrl, dataUrlToBytes, baseName, busyError
  });
})(window);
