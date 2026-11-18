/**
 * File access for the desktop app (Windows and Mac). Runs in Electron's main process (never in the page).
 *  - Data folder files (photos, designs, settings) are reached by paths relative to the
 *    data folder; a path can never leave that folder.
 *  - A CSV file outside the data folder can only be read or written after the person
 *    chose it in the Open dialog (the list of chosen files is kept in allowed-files.json).
 */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/** The folders every data folder has. */
const FOLDERS = ['Data', 'Designs', 'Photos'];

function createFiles(dataRoot, allowedFile) {
  const root = path.resolve(dataRoot);
  let allowed = null;

  function inside(rel) {
    if (typeof rel !== 'string') throw new Error('Invalid file location.');
    const target = path.resolve(root, ...rel.split('/').filter(Boolean));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Invalid file location: ' + rel);
    return target;
  }
  async function loadAllowed() {
    if (allowed) return allowed;
    try { allowed = new Set(JSON.parse(await fsp.readFile(allowedFile, 'utf8'))); } catch (error) { allowed = new Set(); }
    return allowed;
  }
  async function allow(file) {
    const set = await loadAllowed();
    set.add(path.resolve(file).toLowerCase());
    await fsp.mkdir(path.dirname(allowedFile), {recursive: true});
    await fsp.writeFile(allowedFile, JSON.stringify(Array.from(set), null, 2));
  }
  /** A CSV path the person chose, or any file inside the data folder. */
  async function source(file) {
    if (typeof file !== 'string' || !/\.csv$/i.test(file)) throw new Error('Choose a .csv file.');
    const full = path.resolve(file);
    const set = await loadAllowed();
    if (!set.has(full.toLowerCase()) && !full.startsWith(root + path.sep)) throw new Error('Choose this CSV file again in ⚙ Settings.');
    return full;
  }
  function friendly(error, name) {
    if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
      return new Error('“' + name + '” is open in another program (for example Excel). Close it there, then try again.');
    }
    if (error && error.code === 'ENOENT') return new Error('“' + name + '” was moved or deleted. Choose it again in ⚙ Settings.');
    return error;
  }
  /** Writes through a temporary file, so a crash never leaves a half-written file. */
  async function writeSafely(target, data) {
    await fsp.mkdir(path.dirname(target), {recursive: true});
    const temp = target + '.saving-' + process.pid;
    await fsp.writeFile(temp, data);
    try {
      await fsp.rename(temp, target);
    } catch (error) {
      await fsp.rm(temp, {force: true});
      throw friendly(error, path.basename(target));
    }
  }

  return {
    root,
    allow,
    async ensureRoot() {
      for (const name of FOLDERS) await fsp.mkdir(path.join(root, name), {recursive: true});
    },
    /**
     * A CSV chosen somewhere else on the computer is copied into the Data folder, and the app
     * uses that copy from then on. A file already in the Data folder is used as it is.
     * Returns {path, copied}.
     */
    async importCsv(file) {
      const full = path.resolve(file);
      const dataDir = path.join(root, 'Data');
      const relative = path.relative(dataDir, full);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return {path: full, copied: false};
      let bytes;
      try { bytes = await fsp.readFile(full); } catch (error) { throw friendly(error, path.basename(full)); }
      await fsp.mkdir(dataDir, {recursive: true});
      const ext = path.extname(full) || '.csv';
      const base = path.basename(full, path.extname(full));
      for (let n = 1; n < 1000; n++) {
        const target = path.join(dataDir, (n === 1 ? base : base + ' (' + n + ')') + ext);
        try {
          // The same file chosen again: use the copy that is already there.
          if ((await fsp.readFile(target)).equals(bytes)) return {path: target, copied: true};
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fsp.writeFile(target, bytes, {flag: 'wx'});
          return {path: target, copied: true};
        }
      }
      throw new Error('Too many copies of “' + path.basename(full) + '” in the Data folder.');
    },
    async readText(rel) {
      try { return await fsp.readFile(inside(rel), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    writeText: (rel, text) => writeSafely(inside(rel), String(text)),
    readBytes: rel => fsp.readFile(inside(rel)),
    writeBytes: (rel, bytes) => writeSafely(inside(rel), Buffer.from(bytes)),
    async list(rel) {
      let entries;
      try { entries = await fsp.readdir(inside(rel), {withFileTypes: true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      // File details are read many at a time: a folder with hundreds of photos lists quickly.
      const folder = inside(rel);
      const output = [];
      const wanted = entries.filter(entry => entry.isDirectory() || (entry.isFile() && !entry.name.includes('.saving-')));
      for (let i = 0; i < wanted.length; i += 64) {
        const part = await Promise.all(wanted.slice(i, i + 64).map(async entry => {
          if (entry.isDirectory()) return {name: entry.name, kind: 'dir'};
          try {
            const stat = await fsp.stat(path.join(folder, entry.name));
            return {name: entry.name, kind: 'file', size: stat.size, modified: stat.mtimeMs};
          } catch (error) { return null; } // removed while listing
        }));
        part.forEach(item => { if (item) output.push(item); });
      }
      return output;
    },
    ensureDir: async rel => { await fsp.mkdir(inside(rel), {recursive: true}); },
    async exists(rel) {
      try { await fsp.access(inside(rel)); return true; } catch (error) { return false; }
    },
    async moveFile(from, to) {
      const target = inside(to);
      await fsp.mkdir(path.dirname(target), {recursive: true});
      await fsp.rename(inside(from), target);
    },
    remove: rel => fsp.rm(inside(rel), {force: true}),
    async readSource(file) {
      const full = await source(file);
      try { return await fsp.readFile(full); } catch (error) { throw friendly(error, path.basename(full)); }
    },
    /** Written in place (not replaced), so Excel file associations and permissions stay as they were. */
    async writeSource(file, bytes) {
      const full = await source(file);
      try { await fsp.writeFile(full, Buffer.from(bytes)); } catch (error) { throw friendly(error, path.basename(full)); }
    },
    source,
    inside
  };
}

module.exports = {createFiles, FOLDERS};
