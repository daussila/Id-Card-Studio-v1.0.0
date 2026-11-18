/**
 * ID Card Studio — local server.
 *
 * Replaces the Google Apps Script server (Server.gs). The pages call it exactly as they
 * called Apps Script (google.script.run.<function>(…)); it answers from local files:
 *   <data folder>/settings.json        lists and their CSV/column settings
 *   <data folder>/Photos/<list>/       photos, one folder per list
 *   <data folder>/Designs/             card designs saved in Design Studio
 *   the list's CSV file                people; edits are saved straight into it
 *
 * Two columns are added at the end of each CSV the first time its columns are matched:
 *   "ID Card Studio Key"   a permanent code per row (keeps photos with the right person)
 *   "ID Card Studio Photo" the photo's file name in the list's Photos folder
 */
(function (global) {
  'use strict';

  const Csv = global.IDCSCsv;
  const Platform = global.IDCSPlatform;
  const UUID_HEADING = 'ID Card Studio Key';
  const PHOTO_HEADING = 'ID Card Studio Photo';
  const SETTINGS_FILE = 'settings.json';
  const LIST_LIMIT = 20;
  const LIST_COLORS = {
    blue: ['#185adb', '#1248b5', '#e9eef5'], purple: ['#7141c6', '#58309f', '#ece8f4'],
    teal: ['#0f8b8d', '#0b7173', '#e5f0f0'], orange: ['#d97706', '#b45309', '#fbf1e2'],
    green: ['#1f883d', '#166534', '#e7f3ea'], red: ['#b42318', '#912018', '#fbeceb'],
    slate: ['#475467', '#344054', '#eceff3']
  };
  const MAPPING_ROLES = {
    firstName: 'firstName', lastName: 'lastName', fullName: 'fullName', class: 'grade',
    idNumber: 'idNumber', title: 'title', barcodeNumber: 'barcodeNumber', transportation: 'transport',
    section: 'section', homeroom: 'homeroom'
  };
  const IMAGE_FILE = /\.(jpe?g|png|webp|gif|bmp)$/i;
  const DELETED_FOLDER = '_Deleted';
  const TEMPLATES = {cards: 'CardStudio', design: 'Design'};
  const INCLUDES = ['DesignRuntime', 'StudioClient'];

  // ---------------------------------------------------------------- helpers
  const uuid = () => global.crypto.randomUUID();
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const normalizeId = value => String(value == null ? '' : value).trim().toLowerCase();
  const rowHasData = (row, dataWidth) => row.slice(0, dataWidth).some(value => String(value == null ? '' : value).trim());
  const cell = (row, index) => (row && row[index] != null ? String(row[index]) : '');
  const photoBase = name => String(name).normalize('NFC').replace(/\.[^.]+$/, '').trim().replace(/\s+/g, ' ').toLowerCase();
  function columnLetter(index) {
    let value = Number(index) + 1;
    let output = '';
    while (value > 0) {
      value -= 1;
      output = String.fromCharCode(65 + value % 26) + output;
      value = Math.floor(value / 26);
    }
    return output;
  }
  const columnLabel = index => 'Column ' + columnLetter(index);
  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  /** A safe Windows file or folder name. */
  function safeName(text, fallback) {
    let name = String(text || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = '_' + name;
    return (name || fallback || 'Untitled').slice(0, 100);
  }
  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createLocalServer(platform) {
    let settings = null;
    const templateCache = new Map();

    // One change at a time: every request that reads or writes the CSV or settings waits its turn.
    let queue = Promise.resolve();
    function exclusive(task) {
      const run = queue.then(task, task);
      queue = run.catch(() => {});
      return run;
    }

    // -------------------------------------------------------------- settings
    async function loadSettings() {
      if (settings) return settings;
      const text = await platform.readText(SETTINGS_FILE);
      let saved = {};
      try { saved = text ? JSON.parse(text) : {}; } catch (error) {
        throw new Error('settings.json in the data folder is damaged. Restore it from a backup, or rename it to start fresh.');
      }
      settings = {
        version: 1,
        lists: Array.isArray(saved.lists) ? saved.lists : [],
        activeList: String(saved.activeList || ''),
        sources: saved.sources && typeof saved.sources === 'object' ? saved.sources : {},
        schoolName: String(saved.schoolName || '')
      };
      return settings;
    }
    async function saveSettings() {
      await platform.writeText(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    }
    function cardList(id) {
      const list = settings.lists.find(item => item.id === id);
      if (!list) throw new Error('This card list no longer exists. Choose another list.');
      return list;
    }
    const photoDir = list => 'Photos/' + list.photoDir;

    // -------------------------------------------------------------- lists
    function cleanListSettings(input, current) {
      input = input || {};
      const name = String(input.name === undefined ? current.name : input.name).trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) throw new Error('Enter a list name of 1 to 40 characters.');
      const color = input.color === undefined ? current.color : String(input.color);
      if (!LIST_COLORS[color]) throw new Error('Choose one of the list colors.');
      const photoMatch = input.photoMatch === undefined ? current.photoMatch : String(input.photoMatch);
      if (['id', 'name'].indexOf(photoMatch) < 0) throw new Error('Choose how photos are matched.');
      return {name: name, color: color, photoMatch: photoMatch};
    }
    function listSummaries() {
      return settings.lists.map(list => ({
        id: list.id, name: list.name, color: list.color, photoMatch: list.photoMatch,
        accent: (LIST_COLORS[list.color] || LIST_COLORS.blue)[0],
        configured: Boolean(settings.sources[list.id])
      }));
    }
    function cardPage(list) {
      const color = LIST_COLORS[list.color] || LIST_COLORS.blue;
      const folder = 'Photos' + platform.dataSeparator + (list.photoDir || list.name);
      return {
        title: list.name,
        subtitle: 'Find people, manage records and photos, and print cards with your selected design.',
        noun: list.noun || 'Person', plural: list.plural || 'People',
        accent: color[0], accentDark: color[1], tint: color[2],
        color: list.color, photoMatch: list.photoMatch, photoFolder: folder,
        photoHint: list.photoMatch === 'id'
          ? 'Photo files you copy into ' + folder + ' are matched by ID number, for example 12345.jpg.'
          : 'Photo files you copy into ' + folder + ' are matched by full name, for example Alex Smith.jpg.'
      };
    }
    function scopeFor(listId, source) {
      if (!source) return 'idcs_v1_' + listId + '_unconnected_';
      const schema = source.schema || {};
      return 'idcs_v1_' + listId + '_' + hash(source.token + '|' + (source.header ? 1 : 0) + '|' + (schema.layoutRevision || '')) + '_';
    }
    async function uniquePhotoDir(name, exceptId) {
      const base = safeName(name, 'List');
      const used = new Set(settings.lists.filter(list => list.id !== exceptId).map(list => String(list.photoDir).toLowerCase()));
      let candidate = base;
      for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = base + ' (' + n + ')';
      return candidate;
    }

    // -------------------------------------------------------------- CSV context
    /** Reads the list's CSV (or a CSV being set up in Design Mapping). */
    async function sourceContext(listId, override) {
      const list = cardList(listId);
      const source = override || settings.sources[listId];
      if (!source) throw new Error('Choose a CSV file for this list first (⚙ Settings → Choose CSV file).');
      const text = Csv.decode(await platform.readSource(source.token));
      const parsed = Csv.parse(text);
      return {
        listId: listId, list: list, source: source, rows: parsed.rows, delimiter: parsed.delimiter, eol: parsed.eol,
        header: Boolean(source.header), start: source.header ? 1 : 0, schema: source.schema || null
      };
    }
    async function writeContext(c) {
      try {
        await platform.writeSource(c.source.token, Csv.encode(Csv.serialize(c.rows, c.delimiter, c.eol)));
      } catch (error) {
        if (error && /EBUSY|EPERM|EACCES|being used|locked/i.test(String(error.message || error.code))) throw Platform.busyError(c.source.name);
        throw error;
      }
    }
    /** Finds this app's two columns; everything else is the person's data. */
    function inspectColumns(c) {
      const width = Math.max(1, ...c.rows.map(row => row.length));
      const heading = index => c.header ? cell(c.rows[0], index).trim() : '';
      const uuidCols = [];
      const photoCols = [];
      const data = [];
      for (let index = 0; index < width; index++) {
        const isUuid = c.header ? heading(index) === UUID_HEADING : Boolean(c.schema) && index === c.schema.uuidCol;
        const isPhoto = c.header ? heading(index) === PHOTO_HEADING : Boolean(c.schema) && index === c.schema.photoCol;
        if (isUuid) uuidCols.push(index);
        else if (isPhoto) photoCols.push(index);
        else data.push(index);
      }
      // Trailing empty columns are not data.
      const emptyColumn = col => !c.rows.some(row => cell(row, col).trim());
      while (data.length > 1 && emptyColumn(data[data.length - 1])) data.pop();
      const internal = uuidCols.concat(photoCols).sort((a, b) => a - b);
      const remap = {};
      data.forEach(index => { remap[index] = index - internal.filter(col => col < index).length; });
      return {uuid: uuidCols, photo: photoCols, internal: internal, data: data, remap: remap,
        dataWidth: Math.max(1, ...data.map(index => remap[index] + 1))};
    }
    const layoutToken = (c, layout) => JSON.stringify({columns: layout.data, internal: layout.internal, header: c.header});

    /**
     * Puts the two app columns at the end, removes duplicates, gives every row a key,
     * keeps every person's data and existing photo link. Changes c.rows in place.
     */
    function repairColumns(c, layout, regenerate) {
      const preferred = (columns, key) => {
        const current = c.schema && c.schema[key];
        return columns.includes(current) ? [current].concat(columns.filter(index => index !== current)) : columns;
      };
      const uuidCols = preferred(layout.uuid, 'uuidCol');
      const photoCols = preferred(layout.photo, 'photoCol');
      const seen = new Set();
      const before = JSON.stringify(c.rows);
      c.rows = c.rows.map((row, index) => {
        const data = layout.data.map(col => cell(row, col));
        if (c.header && index === 0) return data.concat([UUID_HEADING, PHOTO_HEADING]);
        if (!data.some(value => value.trim())) return data.concat(['', '']);
        const photos = Array.from(new Set(photoCols.map(col => cell(row, col)).filter(Boolean)));
        if (photos.length > 1) {
          throw new Error('Row ' + (index + 1) + ' of the CSV file has two different photo files. Keep one in the “' + PHOTO_HEADING + '” column, then save Design Mapping again.');
        }
        let key = uuidCols.map(col => cell(row, col)).find(Boolean);
        if (regenerate || !key || seen.has(key)) key = uuid();
        seen.add(key);
        return data.concat([key, photos[0] || '']);
      });
      const moved = layout.data.some(col => layout.remap[col] !== col);
      return {
        changed: JSON.stringify(c.rows) !== before,
        schema: {
          dataWidth: layout.dataWidth, uuidCol: layout.dataWidth, photoCol: layout.dataWidth + 1,
          layoutRevision: regenerate || moved ? uuid() : (c.schema && c.schema.layoutRevision) || ''
        }
      };
    }
    function assertSchema(c) {
      const s = c.schema;
      const width = Math.max(0, ...c.rows.map(row => row.length));
      const headingsOk = !c.header || (cell(c.rows[0], s.uuidCol) === UUID_HEADING && cell(c.rows[0], s.photoCol) === PHOTO_HEADING);
      if (!s || width < s.photoCol || !headingsOk) {
        throw new Error('The “' + UUID_HEADING + '” and “' + PHOTO_HEADING + '” columns in the CSV file were moved or removed. Open ⚙ Settings → Design Mapping and save to repair them.');
      }
    }
    /** Gives new or copied rows their own key. A copied row loses the copied photo link. */
    function ensureRecordKeys(c) {
      const s = c.schema;
      const seen = new Set();
      let changed = false;
      c.rows.forEach((row, i) => {
        if (i < c.start || !rowHasData(row, s.dataWidth)) return;
        while (row.length <= s.photoCol) row.push('');
        const key = row[s.uuidCol];
        if (key && !seen.has(key)) { seen.add(key); return; }
        row[s.uuidCol] = uuid();
        seen.add(row[s.uuidCol]);
        if (row[s.photoCol]) row[s.photoCol] = '';
        changed = true;
      });
      return changed;
    }
    function recordHeaders(c) {
      const width = c.schema.dataWidth;
      return Array.from({length: width}, (_, i) => columnLabel(i) + (c.header && cell(c.rows[0], i) ? ' — ' + cell(c.rows[0], i) : ''));
    }
    function buildRecords(c) {
      const s = c.schema;
      const idIndex = s.core.idNumber;
      const counts = Object.create(null);
      const dataRows = c.rows.slice(c.start);
      if (Number.isInteger(idIndex)) {
        dataRows.forEach(row => {
          const id = normalizeId(cell(row, idIndex));
          if (id && rowHasData(row, s.dataWidth)) counts[id] = (counts[id] || 0) + 1;
        });
      }
      const records = [];
      dataRows.forEach((row, i) => {
        if (!rowHasData(row, s.dataWidth)) return;
        const record = {
          recordKey: cell(row, s.uuidCol),
          _photoFileId: cell(row, s.photoCol),
          _sheetRow: i + c.start + 1,
          _row: Array.from({length: s.dataWidth}, (_, col) => cell(row, col))
        };
        Object.keys(s.core).forEach(key => { record[key] = cell(row, s.core[key]).trim(); });
        if (Number.isInteger(idIndex) && counts[normalizeId(cell(row, idIndex))] > 1) record._duplicateId = true;
        records.push(record);
      });
      return {records: records, headers: recordHeaders(c)};
    }
    async function loadRecords(listId) {
      if (!settings.sources[listId]) return {records: [], headers: [], c: null};
      const c = await sourceContext(listId);
      if (!c.schema) return {records: [], headers: [], c: c};
      assertSchema(c);
      if (ensureRecordKeys(c)) await writeContext(c);
      return Object.assign(buildRecords(c), {c: c});
    }

    // -------------------------------------------------------------- photos
    const matchById = list => list.photoMatch === 'id';
    function legacyPhotoName(byId, record) {
      const first = String(record.firstName || '').trim();
      const last = String(record.lastName || '').trim();
      const name = first && last ? first + ' ' + last : record.fullName || first || last;
      return String(byId ? record.idNumber || '' : name || '').trim().replace(/\s+/g, ' ');
    }
    async function photoFiles(list) {
      await platform.ensureDir(photoDir(list));
      return (await platform.list(photoDir(list))).filter(item => item.kind === 'file' && IMAGE_FILE.test(item.name));
    }
    /** Links photo files copied into the folder (named by ID or full name) to their rows. */
    async function linkPhotosByName(c, files) {
      const s = c.schema;
      const byId = matchById(c.list);
      const value = (row, role) => s.core[role] === undefined ? '' : cell(row, s.core[role]).trim();
      const names = c.rows.map((row, i) => i < c.start ? '' : legacyPhotoName(byId, {
        idNumber: value(row, 'idNumber'), fullName: value(row, 'fullName'), firstName: value(row, 'firstName'), lastName: value(row, 'lastName')
      }).toLowerCase());
      if (!c.rows.some((row, i) => names[i] && !cell(row, s.photoCol))) return false;
      const counts = Object.create(null);
      names.forEach(name => { if (name) counts[name] = (counts[name] || 0) + 1; });
      const byName = Object.create(null);
      (files || await photoFiles(c.list)).forEach(item => { (byName[photoBase(item.name)] = byName[photoBase(item.name)] || []).push(item.name); });
      const linked = new Set(c.rows.map(row => cell(row, s.photoCol)).filter(Boolean));
      let changed = false;
      c.rows.forEach((row, i) => {
        const name = names[i];
        const matches = byName[name] || [];
        if (name && !cell(row, s.photoCol) && counts[name] === 1 && matches.length === 1 && !linked.has(matches[0])) {
          while (row.length <= s.photoCol) row.push('');
          row[s.photoCol] = matches[0];
          changed = true;
        }
      });
      return changed;
    }
    /** Keeps a replaced or deleted photo in Photos/<list>/_Deleted instead of erasing it. */
    async function retirePhoto(list, fileName) {
      if (!fileName || !(await platform.exists(photoDir(list) + '/' + fileName))) return;
      let target = photoDir(list) + '/' + DELETED_FOLDER + '/' + fileName;
      if (await platform.exists(target)) target = target.replace(/(\.[^.]+)?$/, ' ' + Date.now() + '$1');
      await platform.ensureDir(photoDir(list) + '/' + DELETED_FOLDER);
      await platform.moveFile(photoDir(list) + '/' + fileName, target);
    }
    function checkPhotoName(name) {
      if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Photo is unavailable.');
      return name;
    }
    // Photos are shrunk in a background worker; the page itself only does it if the worker cannot run.
    let worker = null;
    let workerFailed = false;
    let nextJob = 1;
    const jobs = new Map();
    function photoWorker() {
      if (worker || workerFailed) return worker;
      try {
        worker = new Worker('photo-worker.js');
        worker.onmessage = event => {
          const job = jobs.get(event.data.id);
          if (!job) return;
          jobs.delete(event.data.id);
          if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data.dataUrl);
        };
        worker.onerror = () => {
          workerFailed = true;
          worker = null;
          jobs.forEach(job => job.reject(new Error('Photo worker stopped.')));
          jobs.clear();
        };
      } catch (error) {
        workerFailed = true;
        worker = null;
      }
      return worker;
    }
    function shrinkInWorker(bytes, mime, maxSide, quality, keepSmall) {
      const target = photoWorker();
      if (!target) return Promise.reject(new Error('No photo worker.'));
      return new Promise((resolve, reject) => {
        const id = nextJob++;
        jobs.set(id, {resolve, reject});
        const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
        target.postMessage({id, bytes: copy.buffer, mime, maxSide, quality, keepSmall}, [copy.buffer]);
      });
    }
    async function shrinkOnPage(bytes, mime, maxSide, quality, keepSmall) {
      try {
        const bitmap = await createImageBitmap(new Blob([bytes], {type: mime}));
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && bytes.length < keepSmall) { bitmap.close(); return Platform.bytesToDataUrl(bytes, mime); }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return canvas.toDataURL('image/jpeg', quality);
      } catch (error) {
        return Platform.bytesToDataUrl(bytes, mime);
      }
    }
    /** Gallery photos: at most 640 pixels. Printing / large view: at most 1000 pixels (as before). */
    async function shrinkPhoto(bytes, mime, full) {
      const maxSide = full ? 1000 : 640;
      const quality = full ? 0.92 : 0.88;
      const keepSmall = full ? Infinity : 400000;
      if (bytes.length < 60000) return Platform.bytesToDataUrl(bytes, mime); // already small
      try {
        return await shrinkInWorker(bytes.slice(), mime, maxSide, quality, keepSmall);
      } catch (error) {
        return shrinkOnPage(bytes, mime, maxSide, quality, keepSmall);
      }
    }

    // -------------------------------------------------------------- templates
    async function fetchText(path) {
      if (templateCache.has(path)) return templateCache.get(path);
      const response = await fetch(path, {cache: 'no-cache'});
      if (!response.ok) throw new Error('Could not load ' + path + '.');
      const text = await response.text();
      templateCache.set(path, text);
      return text;
    }
    /** Renders the page tags used by the Apps Script templates. */
    async function renderTemplate(name, values) {
      let html = await fetchText('pages/' + name + '.html');
      const includes = {};
      for (const include of INCLUDES) {
        if (html.includes("include('" + include + "')")) includes[include] = await fetchText('pages/' + include + '.html');
      }
      return html.replace(/<\?(!?=)\s*([\s\S]*?)\s*;?\s*\?>/g, (whole, kind, expression) => {
        let match = expression.match(/^include\('([A-Za-z]+)'\)$/);
        if (match && kind === '!=' && includes[match[1]] !== undefined) return includes[match[1]];
        if (/^jsonForScript_\(initialData\)$/.test(expression) && kind === '!=') return jsonForScript(values.initialData);
        match = expression.match(/^page\.([A-Za-z]+)$/);
        if (match && values.page) return kind === '=' ? escapeHtml(values.page[match[1]]) : String(values.page[match[1]] == null ? '' : values.page[match[1]]);
        throw new Error('Unsupported page tag: ' + whole);
      });
    }

    // -------------------------------------------------------------- list data
    async function cardListData(listId, activate) {
      const list = settings.lists.find(item => item.id === listId) ||
        (activate ? settings.lists.find(item => item.id === settings.activeList) || settings.lists[0] : null) || null;
      const data = {
        list: '', lists: listSummaries(), records: null, headers: [], error: '',
        scope: 'idcs_v1_nolist_', configuration: {hasSpreadsheet: false, hasPhotoFolder: false},
        page: Object.assign(cardPage({name: 'No list yet', color: 'blue', photoMatch: 'name', photoDir: ''}), {subtitle: 'Create a list to get started.'})
      };
      if (!list) return data;
      if (activate && settings.activeList !== list.id) { settings.activeList = list.id; await saveSettings(); }
      const source = settings.sources[list.id];
      data.list = list.id;
      data.page = cardPage(list);
      data.scope = scopeFor(list.id, source);
      data.configuration = {hasSpreadsheet: Boolean(source), hasPhotoFolder: true};
      data.source = source ? {name: source.name, location: await platform.sourceLocation(source.token).catch(() => source.name)} : null;
      if (source) {
        try {
          const payload = await loadRecords(list.id);
          data.records = payload.records;
          data.headers = payload.headers;
        } catch (error) {
          data.error = error.message || String(error);
        }
      }
      return data;
    }

    // -------------------------------------------------------------- records
    async function changeRecord(listId, record, originalKey, remove) {
      const c = await sourceContext(listId);
      const s = c.schema;
      if (!s) throw new Error('Choose your card design and match its columns (Design Mapping) before editing records.');
      assertSchema(c);
      if (remove && !originalKey) throw new Error('Select a record to delete.');
      ensureRecordKeys(c);
      if (originalKey) await linkPhotosByName(c);
      const matches = [];
      if (originalKey) {
        c.rows.forEach((row, i) => { if (i >= c.start && cell(row, s.uuidCol) === originalKey) matches.push(i); });
        if (matches.length !== 1) throw new Error('The record changed or no longer exists. Use Refresh Data in ⚙ Settings, then try again.');
      }
      const index = matches.length ? matches[0] : -1;
      const old = index >= 0 ? c.rows[index] : null;
      let savedKey = '';
      if (remove) {
        const photo = cell(old, s.photoCol);
        c.rows.splice(index, 1);
        await writeContext(c);
        if (photo && !c.rows.some(row => cell(row, s.photoCol) === photo)) await retirePhoto(c.list, photo).catch(() => {});
      } else {
        const values = record && record.columnValues;
        if (!values || typeof values !== 'object') throw new Error('Use the record form.');
        const draft = old ? old.slice() : new Array(s.photoCol + 1).fill('');
        while (draft.length <= s.photoCol) draft.push('');
        Object.keys(values).forEach(key => {
          const col = Number(key);
          if (!Number.isInteger(col) || !s.writable.includes(col)) throw new Error('Column matching changed. Reopen the record form.');
          const text = String(values[key] == null ? '' : values[key]);
          if (text.length > 50000) throw new Error('A field is too long.');
          draft[col] = text;
        });
        if (!rowHasData(draft, s.dataWidth)) throw new Error('Enter record data first.');
        const idIndex = s.core.idNumber;
        if (Number.isInteger(idIndex) && (!old || normalizeId(cell(old, idIndex)) !== normalizeId(draft[idIndex]))) {
          const id = normalizeId(draft[idIndex]);
          const clash = id ? c.rows.findIndex((row, i) => i >= c.start && i !== index && normalizeId(cell(row, idIndex)) === id) : -1;
          if (clash >= 0) throw new Error('ID ' + draft[idIndex] + ' is already used in row ' + (clash + 1) + ' of the CSV file.');
        }
        if (old) c.rows[index] = draft;
        else {
          draft[s.uuidCol] = uuid();
          // Before trailing empty rows, so the new person sits right after the last one.
          let insertAt = c.rows.length;
          while (insertAt > c.start && !rowHasData(c.rows[insertAt - 1], s.dataWidth)) insertAt--;
          // Alphabetical by the first column: before the first person who comes after them.
          const first = String(draft[0] || '').trim();
          if (first) {
            const collator = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});
            for (let i = c.start; i < insertAt; i++) {
              const other = cell(c.rows[i], 0).trim();
              if (other && collator.compare(other, first) > 0) { insertAt = i; break; }
            }
          }
          c.rows.splice(insertAt, 0, draft);
        }
        savedKey = draft[s.uuidCol];
        await writeContext(c);
      }
      return Object.assign({success: true, savedKey: savedKey}, buildRecords(c));
    }

    // ================================================================ public API
    const api = {
      async init() { await loadSettings(); return true; },

      // ---------- pages ----------
      async getStudioTabHtml(studio, listId) {
        if (!Object.prototype.hasOwnProperty.call(TEMPLATES, studio)) throw new Error('Unknown page.');
        const values = {};
        let data = null;
        if (studio === 'cards') {
          data = await cardListData(String(listId || ''), true);
          values.initialData = data;
          values.page = data.page;
        }
        const bridge = await fetchText('pages/StudioTabBridge.html');
        const html = (await renderTemplate(TEMPLATES[studio], values)).replace(/<head\b[^>]*>/i, head => head + '\n' + bridge);
        return {studio: studio, list: data ? data.list : '', html: html};
      },
      getStudioTabsAccess: async () => ({isAdministrator: false}),
      recordStudioPrintRequest: async () => ({recorded: false}),

      // ---------- lists ----------
      async getCardListData(listId, activate) { return cardListData(String(listId || ''), activate !== false); },
      async recordListOpen(listId) {
        cardList(listId);
        if (settings.activeList !== listId) { settings.activeList = listId; await saveSettings(); }
        return {recorded: false};
      },
      async createCardList(input) {
        if (settings.lists.length >= LIST_LIMIT) throw new Error('You can have up to ' + LIST_LIMIT + ' lists. Remove one you no longer use first.');
        const clean = cleanListSettings(input, {name: '', color: 'blue', photoMatch: 'name'});
        if (settings.lists.some(list => list.name.toLowerCase() === clean.name.toLowerCase())) throw new Error('You already have a list called “' + clean.name + '”.');
        const list = Object.assign({id: 'l' + uuid().replace(/-/g, '').slice(0, 12), noun: 'Person', plural: 'People'}, clean);
        list.photoDir = await uniquePhotoDir(clean.name, list.id);
        await platform.ensureDir('Photos/' + list.photoDir);
        settings.lists.push(list);
        await saveSettings();
        return {id: list.id};
      },
      async updateCardList(id, input) {
        const list = cardList(id);
        const clean = cleanListSettings(input, list);
        if (settings.lists.some(item => item.id !== id && item.name.toLowerCase() === clean.name.toLowerCase())) throw new Error('You already have a list called “' + clean.name + '”.');
        Object.assign(list, clean);
        await saveSettings();
        return {id: id};
      },
      async deleteCardList(id) {
        cardList(id);
        settings.lists = settings.lists.filter(item => item.id !== id);
        delete settings.sources[id];
        if (settings.activeList === id) settings.activeList = '';
        await saveSettings();
        return {next: settings.lists.length ? settings.lists[0].id : ''};
      },

      // ---------- CSV file and column matching ----------
      /** Opens the file picker. Must be started by a click. */
      async pickCsvSource() { return platform.pickCsv(); },
      async getDesignMappingInfo(listId, token, sheetId, header) {
        const current = settings.sources[listId];
        const sameFile = !token || (current && current.token === token);
        const source = sameFile && current ? Object.assign({}, current) : {token: token, name: await platform.sourceName(token), header: true, schema: null};
        if (typeof header === 'boolean') source.header = header;
        if (!source.token) throw new Error('Choose a CSV file first.');
        const c = await sourceContext(listId, source);
        const layout = inspectColumns(c);
        const sample = c.rows[c.start] || [];
        return {
          spreadsheetId: source.token, sheetId: 0, header: c.header,
          scope: scopeFor(listId, source),
          worksheets: [{id: 0, name: source.name}],
          columns: layout.data.map(index => ({
            index: index,
            label: columnLabel(index) + (c.header && cell(c.rows[0], index) ? ' — ' + cell(c.rows[0], index) : ''),
            sample: cell(sample, index)
          })),
          layoutToken: layoutToken(c, layout),
          schemaReady: Boolean(c.schema),
          fileName: source.name
        };
      },
      async saveDesignMapping(listId, input) {
        if (!input || !Array.isArray(input.fields)) throw new Error('Invalid design mapping.');
        const current = settings.sources[listId];
        const token = input.spreadsheetUrl || (current && current.token);
        if (!token) throw new Error('Choose a CSV file first.');
        const sameFile = current && current.token === token;
        const source = {
          token: token, name: sameFile ? current.name : await platform.sourceName(token),
          header: typeof input.header === 'boolean' ? input.header : Boolean(sameFile && current.header),
          schema: sameFile ? current.schema || null : null
        };
        const c = await sourceContext(listId, source);
        const layout = inspectColumns(c);
        if (input.layoutToken && input.layoutToken !== layoutToken(c, layout)) {
          throw new Error('The CSV file’s columns changed. Open Design Mapping again to review them.');
        }
        const core = {};
        const fields = input.fields.map(field => {
          const index = Number(field.columnIndex);
          if (!Number.isInteger(index) || !layout.data.includes(index)) throw new Error('Choose an existing column for each matched element.');
          const role = MAPPING_ROLES[field.type];
          if (role && core[role] === undefined) core[role] = index;
          return {id: String(field.id || ''), type: field.type, columnIndex: layout.remap[index]};
        });
        if (c.schema) {
          Object.keys(c.schema.core || {}).forEach(role => {
            if (core[role] === undefined && layout.data.includes(c.schema.core[role])) core[role] = c.schema.core[role];
          });
        }
        const repaired = repairColumns(c, layout, false);
        const schema = repaired.schema;
        schema.core = {};
        Object.keys(core).forEach(role => { schema.core[role] = layout.remap[core[role]]; });
        schema.writable = Array.from(new Set(fields.map(field => field.columnIndex)));
        c.schema = schema;
        source.schema = schema;
        const linked = await linkPhotosByName(c).catch(() => false);
        if (repaired.changed || linked) await writeContext(c);
        settings.sources[listId] = source;
        await saveSettings();
        return {success: true, scope: scopeFor(listId, source), fields: fields};
      },
      async resetStudioRecordCodes(listId) {
        const current = settings.sources[listId];
        if (!current) return {success: true};
        const c = await sourceContext(listId);
        const layout = inspectColumns(c);
        if (!c.schema && !layout.internal.length) return {success: true};
        const oldCore = (c.schema && c.schema.core) || {};
        const repaired = repairColumns(c, layout, true);
        repaired.schema.core = {};
        Object.keys(oldCore).forEach(role => {
          if (layout.data.includes(oldCore[role])) repaired.schema.core[role] = layout.remap[oldCore[role]];
        });
        repaired.schema.writable = [];
        await writeContext(c);
        current.schema = repaired.schema;
        await saveSettings();
        return {success: true};
      },
      async getConfiguredSpreadsheetHeaders(listId) {
        const c = await sourceContext(listId);
        if (c.schema) return recordHeaders(c);
        const layout = inspectColumns(c);
        return layout.data.map(index => columnLabel(index) + (c.header && cell(c.rows[0], index) ? ' — ' + cell(c.rows[0], index) : ''));
      },

      // ---------- records ----------
      async getStudioRecords(listId) {
        const result = await loadRecords(listId);
        return {records: result.records, headers: result.headers};
      },
      addStudioRecord: (listId, record) => changeRecord(listId, record, null, false),
      updateStudioRecord(listId, record, key) {
        if (!key) throw new Error('Select a record first.');
        return changeRecord(listId, record, String(key), false);
      },
      deleteStudioRecord: (listId, key) => changeRecord(listId, null, String(key || ''), true),

      // ---------- photos ----------
      async getStudioPhotoManifest(listId, keys) {
        const list = cardList(listId);
        const loaded = await loadRecords(listId);
        const files = await photoFiles(list); // the photo folder is read once
        if (loaded.c && loaded.c.schema && await linkPhotosByName(loaded.c, files)) {
          // Linking new photos is a bonus: if the CSV is open in Excel, try again next time.
          try {
            await writeContext(loaded.c);
            Object.assign(loaded, buildRecords(loaded.c));
          } catch (error) { /* photos are still found by name below */ }
        }
        const records = loaded.records;
        const byKey = new Map(records.map(r => [r.recordKey, r]));
        const fileOwners = Object.create(null);
        records.forEach(r => { if (r._photoFileId) fileOwners[r._photoFileId] = (fileOwners[r._photoFileId] || 0) + 1; });
        const byName = Object.create(null);
        const byFile = Object.create(null);
        const counts = Object.create(null);
        const useId = matchById(list);
        records.forEach(r => {
          const name = legacyPhotoName(useId, r).toLowerCase();
          counts[name] = (counts[name] || 0) + 1;
        });
        files.forEach(item => {
          const entry = {fileId: item.name, updated: item.modified || 0};
          byFile[item.name] = entry;
          (byName[photoBase(item.name)] = byName[photoBase(item.name)] || []).push(entry);
        });
        return (keys || []).map(key => {
          const record = byKey.get(String(key));
          if (!record) return {key: key, status: 'failed', error: 'Record not found'};
          let entry = record._photoFileId ? byFile[record._photoFileId] : null;
          if (!entry) {
            const name = legacyPhotoName(useId, record).toLowerCase();
            const matches = byName[name] || [];
            if (matches.length > 1 || (matches.length && counts[name] > 1)) {
              return {key: key, status: 'failed', error: 'Two photos or two people share the name “' + name + '”. Take a photo for this person.'};
            }
            entry = matches[0];
            if (entry && fileOwners[entry.fileId]) {
              return {key: key, status: 'failed', error: 'This photo belongs to another person. Take a photo for this person.'};
            }
          }
          return entry ? {key: key, status: 'ready', fileId: entry.fileId, updated: entry.updated} : {key: key, status: 'missing'};
        });
      },
      /** full = false returns a small copy for the gallery; full = true the original for printing. */
      async getStudioPhotoFile(listId, fileId, full) {
        const list = cardList(listId);
        const name = checkPhotoName(String(fileId || ''));
        let bytes;
        try { bytes = await platform.readBytes(photoDir(list) + '/' + name); } catch (error) {
          throw new Error('Photo file “' + name + '” is missing from ' + list.photoDir + '.');
        }
        const mime = Platform.mimeFor(name);
        return shrinkPhoto(bytes, mime, Boolean(full));
      },
      async saveStudioPhoto(listId, dataUrl, key) {
        if (typeof dataUrl !== 'string' || dataUrl.length > 14000000 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
          throw new Error('Invalid photo. Capture a JPEG or PNG image again.');
        }
        const list = cardList(listId);
        const c = await sourceContext(listId);
        const s = c.schema;
        if (!s) throw new Error('Choose your card design and match its columns first.');
        assertSchema(c);
        ensureRecordKeys(c);
        const index = c.rows.findIndex((row, i) => i >= c.start && cell(row, s.uuidCol) === String(key));
        if (index < 0) throw new Error('This person was removed from the CSV file. Use Refresh Data.');
        const row = c.rows[index];
        const value = role => s.core[role] === undefined ? '' : cell(row, s.core[role]).trim();
        const extension = dataUrl.startsWith('data:image/png') ? '.png' : '.jpg';
        const base = safeName(legacyPhotoName(matchById(list), {
          idNumber: value('idNumber'), fullName: value('fullName'), firstName: value('firstName'), lastName: value('lastName')
        }) || String(key), String(key));
        const previous = cell(row, s.photoCol);
        // Another person's photo with the same file name is never overwritten.
        const usedByOthers = new Set(c.rows.filter((other, i) => i >= c.start && i !== index).map(other => cell(other, s.photoCol)).filter(Boolean));
        let name = base + extension;
        for (let n = 2; usedByOthers.has(name); n++) name = base + ' (' + n + ')' + extension;
        if (previous && previous !== name && !usedByOthers.has(previous)) await retirePhoto(list, previous).catch(() => {});
        await platform.ensureDir(photoDir(list));
        await platform.writeBytes(photoDir(list) + '/' + name, Platform.dataUrlToBytes(dataUrl));
        while (row.length <= s.photoCol) row.push('');
        if (row[s.photoCol] !== name) {
          row[s.photoCol] = name;
          await writeContext(c);
        }
        return {success: true, fileName: name, fileId: name};
      },

      // ---------- school name (shown at the top of the app) ----------
      async getSchoolName() { return settings.schoolName || ''; },
      async saveSchoolName(name) {
        const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
        if (clean.length > 80) throw new Error('Enter a school name of up to 80 characters.');
        settings.schoolName = clean;
        await saveSettings();
        return clean;
      },

      // ---------- files and folders ----------
      async getListLocations(listId) {
        const list = cardList(listId);
        const source = settings.sources[listId];
        const sep = platform.dataSeparator;
        return {
          dataFolder: platform.dataLabel,
          photoFolder: platform.dataLabel + sep + 'Photos' + sep + list.photoDir,
          csvName: source ? source.name : '',
          csvLocation: source ? await platform.sourceLocation(source.token).catch(() => source.name) : '',
          canOpen: platform.canOpenFiles
        };
      },
      async openListResource(listId, which) {
        const list = cardList(listId);
        if (!platform.canOpenFiles) return {opened: false};
        if (which === 'csv') {
          const source = settings.sources[listId];
          if (!source) throw new Error('No CSV file is connected yet.');
          await platform.openSource(source.token);
        } else {
          await platform.ensureDir(photoDir(list));
          await platform.openData(photoDir(list));
        }
        return {opened: true};
      },
      async openDataFolder(which) {
        if (!platform.canOpenFiles) return {opened: false};
        await platform.openData(which === 'designs' ? 'Designs' : '');
        return {opened: true};
      },

      // ---------- designs ----------
      async listDesigns() {
        await platform.ensureDir('Designs');
        return (await platform.list('Designs'))
          .filter(item => item.kind === 'file' && /\.json$/i.test(item.name))
          .sort((a, b) => (b.modified || 0) - (a.modified || 0))
          .map(item => ({name: item.name, modified: item.modified || 0}));
      },
      async readDesign(fileName) {
        const name = checkPhotoName(String(fileName || ''));
        const text = await platform.readText('Designs/' + name);
        if (text == null) throw new Error('“' + name + '” is no longer in the Designs folder.');
        return text;
      },
      /**
       * A design opened from anywhere else on the computer is copied into the Designs folder.
       * The same file chosen again (same name and content) is not copied twice.
       * Returns {fileName, copied}.
       */
      async importDesign(fileName, text) {
        if (typeof text !== 'string' || text.length > 20000000) throw new Error('The design is too large.');
        const parsed = JSON.parse(text);
        if (!parsed || parsed.fileType !== 'ID_CARD_DESIGN') throw new Error('Choose a .json file saved by Design Studio.');
        await platform.ensureDir('Designs');
        const base = safeName(String(fileName || '').replace(/\.json$/i, ''), 'Untitled');
        for (let n = 1; n < 1000; n++) {
          const name = (n === 1 ? base : base + ' (' + n + ')') + '.json';
          const existing = await platform.readText('Designs/' + name);
          if (existing === text) return {fileName: name, copied: false};
          if (existing == null) {
            await platform.writeText('Designs/' + name, text);
            return {fileName: name, copied: true};
          }
        }
        throw new Error('Too many designs with this name in the Designs folder.');
      },
      async saveDesign(fileName, text) {
        const name = safeName(String(fileName || '').replace(/\.json$/i, ''), 'Untitled') + '.json';
        if (typeof text !== 'string' || text.length > 20000000) throw new Error('The design is too large to save.');
        JSON.parse(text);
        await platform.writeText('Designs/' + name, text);
        return {fileName: name, location: platform.dataLabel + platform.dataSeparator + 'Designs' + platform.dataSeparator + name};
      }
    };

    // Photo files are read in parallel; everything else waits its turn.
    const parallel = new Set(['getStudioPhotoFile', 'getStudioTabsAccess', 'recordStudioPrintRequest', 'pickCsvSource', 'readDesign', 'listDesigns']);
    const wrapped = {};
    Object.keys(api).forEach(name => {
      wrapped[name] = (...args) => (parallel.has(name) || name === 'init' ? api[name](...args) : exclusive(() => api[name](...args)));
    });
    return Object.freeze(wrapped);
  }

  /** A drop-in replacement for google.script.run backed by the local server. */
  function createGoogleShim(server) {
    function runner(success, failure) {
      return new Proxy({}, {
        get(target, name) {
          if (name === 'withSuccessHandler') return handler => runner(handler, failure);
          if (name === 'withFailureHandler') return handler => runner(success, handler);
          if (name === 'withUserObject') return () => runner(success, failure);
          return (...args) => {
            Promise.resolve()
              .then(() => {
                if (typeof server[name] !== 'function') throw new Error('Unknown action: ' + String(name));
                return server[name](...clone(args));
              })
              .then(result => { if (success) success(clone(result)); },
                error => { if (failure) failure(error instanceof Error ? error : new Error(String(error))); });
          };
        }
      });
    }
    return {script: {run: runner(null, null)}};
  }

  global.IDCSLocalServer = Object.freeze({create: createLocalServer, googleShim: createGoogleShim, UUID_HEADING, PHOTO_HEADING});
})(window);
