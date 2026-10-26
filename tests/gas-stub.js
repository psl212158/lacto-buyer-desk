// Runs apps-script/Code.gs under Node with minimal in-memory stand-ins for the Apps Script services Code.gs uses, so it can run under Node for testing.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function a1(ref) {
  const m = /^([A-Z]+)(\d*)/.exec(ref);
  const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return {r: m[2] ? +m[2] : 1, c: col};
}

function makeRuntime(opts = {}) {
  const props = Object.assign({}, opts.props || {});
  const sheets = new Map();
  const files = new Map();
  const folders = new Map();
  let seq = 0;
  const fetchLog = [];

  function Sheet(name) {
    const rows = [];
    const ensure = (r, c) => { while (rows.length < r) rows.push([]); const row = rows[r - 1]; while (row.length < c) row.push(''); };
    const range = (r, c, nr = 1, nc = 1) => {
      const api = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((rows[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
        getValue: () => ((rows[r - 1] || [])[c - 1]) ?? '',
        setValues: v => { v.forEach((row, i) => row.forEach((x, j) => { ensure(r + i, c + j); rows[r - 1 + i][c - 1 + j] = x; })); return api; },
        setNumberFormat: () => api, setFontWeight: () => api, setFontSize: () => api
      };
      return api;
    };
    return {
      name, rows,
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') { const p = a1(a.split(':')[0]); return range(p.r, p.c); }
        return range(a, b, c, d);
      },
      getLastRow: () => { let n = rows.length; while (n > 0 && rows[n - 1].every(x => x === '' || x == null)) n--; return n; },
      deleteRow: r => { rows.splice(r - 1, 1); },
      setFrozenRows: () => {}, setColumnWidth: () => {},
      clearContents: () => { rows.length = 0; }
    };
  }
  const ss = {
    getId: () => 'sheet0000001', getUrl: () => 'https://docs.google.com/spreadsheets/d/sheet0000001',
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = Sheet(n); sheets.set(n, s); return s; }
  };
  const folderObj = id => ({
    getId: () => id,
    createFile: blob => { const fid = 'file' + String(++seq).padStart(12, '0'); files.set(fid, {blob, parent: id, trashed: false}); return fileObj(fid); }
  });
  const fileObj = fid => ({
    getId: () => fid,
    getMimeType: () => files.get(fid).blob.type,
    getBlob: () => ({getBytes: () => files.get(fid).blob.bytes}),
    getParents: () => { const p = [files.get(fid).parent]; let i = 0; return {hasNext: () => i < p.length, next: () => folderObj(p[i++])}; },
    setTrashed: t => { files.get(fid).trashed = t; }
  });
  let ocrDocs = 0;
  const g = {
    console, JSON, Date, Math, Object, Array, String, Number, RegExp, Error,
    SpreadsheetApp: {
      getActive: () => (opts.bound === false ? null : ss),
      openById: id => { if (id !== 'sheet0000001') throw new Error('no sheet'); return ss; },
      create: () => ss,
      getUi: () => ({createMenu: () => ({addItem() { return this; }, addToUi() {}})})
    },
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }})},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: t => ({text: t, setMimeType() { return this; }})},
    DriveApp: {
      createFolder: name => { const id = 'folder' + String(++seq).padStart(10, '0'); folders.set(id, name); return folderObj(id); },
      getFolderById: id => { if (!folders.has(id)) throw new Error('no folder'); return folderObj(id); },
      getFileById: id => { if (!files.has(id) || files.get(id).trashed) throw new Error('no file'); return fileObj(id); }
    },
    Utilities: {
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: (data, type, name) => ({bytes: data, type, name, getBytes: () => (typeof data === 'string' ? Array.from(Buffer.from(data)) : data)}),
      formatDate: () => '20261026_120000',
      getUuid: () => '1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890',
      sleep: () => {}
    },
    UrlFetchApp: {
      fetch: (url, o = {}) => {
        fetchLog.push({url, o});
        let status = 200, body = '';
        if (/upload\/drive\/v3\/files/.test(url)) {
          if (opts.ocrStatus) status = opts.ocrStatus;
          body = JSON.stringify({id: 'ocrdoc' + (++ocrDocs)});
        } else if (/\/export\?mimeType=text\/plain/.test(url)) {
          const t = opts.ocrText;
          body = typeof t === 'function' ? t(ocrDocs) : (t || '');
        }
        return {getResponseCode: () => status, getContentText: () => body};
      }
    },
    ScriptApp: {
      getOAuthToken: () => 'token', getService: () => ({getUrl: () => opts.url || null}),
      getProjectTriggers: () => [], newTrigger: () => ({timeBased() { return this; }, everyMinutes() { return this; }, create() {}})
    },
    Logger: {log: () => {}}
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8') + '\nthis.__api = {doPost, doGet, setup, rebuildBuyerSheet, parseCardText_};', g);
  const post = body => JSON.parse(g.__api.doPost({postData: {contents: JSON.stringify(body)}}).text);
  return {post, api: g.__api, sheets, files, props, fetchLog};
}
module.exports = {makeRuntime};
