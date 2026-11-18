/**
 * CSV reading and writing for ID Card Studio.
 * Handles files saved by Excel: UTF-8 with or without BOM, older ANSI (Windows-1252)
 * files, comma / semicolon / tab separators, quoted cells with line breaks.
 * Files are always written back as UTF-8 with BOM, which Excel opens correctly.
 */
(function (global) {
  'use strict';

  /** Bytes → text. Invalid UTF-8 means an older ANSI file from Excel. */
  function decode(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(view);
    } catch (error) {
      text = new TextDecoder('windows-1252').decode(view);
    }
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  /** Text → bytes, with the BOM Excel needs to recognise UTF-8. */
  function encode(text) {
    return new TextEncoder().encode('﻿' + text);
  }

  /** The separator used in the first line (outside quotes): comma, semicolon or tab. */
  function detectDelimiter(text) {
    const counts = {',': 0, ';': 0, '\t': 0};
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === '\n' || ch === '\r')) break;
      else if (!quoted && ch in counts) counts[ch]++;
    }
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return counts[best] > 0 ? best : ',';
  }

  /** RFC 4180 parser. Returns {rows, eol}; a final line break does not create an empty row. */
  function parse(text, delimiter) {
    delimiter = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let eol = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (!eol) eol = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch;
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return {rows: rows, eol: eol || '\r\n', delimiter: delimiter};
  }

  function needsQuotes(value, delimiter) {
    return value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r') ||
      /^\s|\s$/.test(value);
  }

  /** Rows → CSV text. Every row gets the same number of cells so Excel keeps the columns aligned. */
  function serialize(rows, delimiter, eol) {
    delimiter = delimiter || ',';
    eol = eol || '\r\n';
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return rows.map(row => {
      const cells = [];
      for (let i = 0; i < width; i++) {
        const value = row[i] == null ? '' : String(row[i]);
        cells.push(needsQuotes(value, delimiter) ? '"' + value.replace(/"/g, '""') + '"' : value);
      }
      return cells.join(delimiter);
    }).join(eol) + eol;
  }

  global.IDCSCsv = Object.freeze({decode, encode, detectDelimiter, parse, serialize});
})(typeof window !== 'undefined' ? window : globalThis);
