'use strict';
/**
 * shims.js — Google Apps Script サービスのインメモリ実装(GAS互換ハーネス用)。
 * SpreadsheetApp / DriveApp / LockService / CacheService / PropertiesService / Utilities /
 * ContentService / MailApp / HtmlService / Session / ScriptApp。
 * 実GASの制約に近づけるため、範囲外アクセスや大きすぎるキャッシュ値は例外にする。
 */
const crypto = require('crypto');

function toSigned(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  return out;
}
function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (Array.isArray(v)) return Buffer.from(v.map((b) => b & 255));
  throw new Error('バイト列として扱えない値です');
}

function createShims(state) {
  // state: { nowMs(): number, baseUrl: string }
  state.mails = [];
  state.logs = [];
  state.loggerLines = [];
  state.triggers = [];
  state.lockHeld = false;        // スクリプトロックの保持状態
  state.userLockHeld = false;    // ユーザーロックの保持状態
  state.lockOrderViolation = 0;  // ユーザーロックを持ったままスクリプトロックを取った回数(0であるべき)
  state.lockWaits = 0;
  state.beforeScriptLock = null; // スクリプトロック取得の直前に呼ぶフック(interleave 用)
  state.driveLog = [];           // 仮想Driveの書込履歴 {op, path, fileId, lockHeld, at}
  state.driveFail = null;        // テスト用: { createFile: n } で n 回目の createFile を例外にする
  state.rootName = '';           // 仮想Driveのルートフォルダ名(パス表示用)
  state.cacheStats = { hits: 0, misses: 0, skippedTooLarge: 0 };

  /* ---------- Blob ---------- */
  class Blob {
    constructor(bytes, contentType, name) {
      this._buf = toBuffer(bytes); this._ct = contentType || 'application/octet-stream'; this._name = name || '';
    }
    getBytes() { return toSigned(this._buf); }
    getContentType() { return this._ct; }
    getName() { return this._name; }
    setName(n) { this._name = n; return this; }
    setContentType(c) { this._ct = c; return this; }
    getAs(type) { return new Blob(this._buf, type, this._name); }
  }
  class HtmlBlob extends Blob {
    getAs(type) {
      if (type !== 'application/pdf') return new Blob(this._buf, type, this._name);
      const html = this._buf.toString('utf8');
      const m = /<!--REPORT (.*?)-->/.exec(html);
      const line = 'MOCK REPORT ' + (m ? m[1] : 'unknown');
      const text = `%PDF-1.4\n% ${line.replace(/[^\x20-\x7e]/g, '?')}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
      return new Blob(Buffer.from(text, 'ascii'), 'application/pdf', this._name);
    }
  }

  /* ---------- Utilities ---------- */
  const Utilities = {
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5', SHA_1: 'SHA_1' },
    getUuid: () => crypto.randomUUID(),
    computeDigest(alg, value) {
      if (alg !== 'SHA_256') throw new Error('未対応のアルゴリズム');
      return toSigned(crypto.createHash('sha256').update(toBuffer(value)).digest());
    },
    computeHmacSha256Signature(value, key) {
      return toSigned(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest());
    },
    base64Encode(v) { return toBuffer(v).toString('base64'); },
    base64Decode(s) {
      if (typeof s !== 'string' || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) throw new Error('Invalid base64');
      return toSigned(Buffer.from(s, 'base64'));
    },
    newBlob(bytes, contentType, name) { return new Blob(bytes, contentType, name); },
    sleep() {},
    formatDate(d, tz, fmt) {
      const t = new Date(d.getTime() + 9 * 3600 * 1000);
      return fmt.replace('yyyy', t.getUTCFullYear()).replace('MM', String(t.getUTCMonth() + 1).padStart(2, '0'))
        .replace('dd', String(t.getUTCDate()).padStart(2, '0'));
    },
  };

  /* ---------- SpreadsheetApp ---------- */
  class Range {
    constructor(sheet, r, c, nr, nc) { this.sh = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    _check() {
      if (this.r < 1 || this.c < 1 || this.nr < 1 || this.nc < 1 || this.r + this.nr - 1 > this.sh.maxRows || this.c + this.nc - 1 > this.sh.maxCols) {
        throw new Error('The coordinates or dimensions of the range are outside the dimensions of the sheet.');
      }
    }
    getValues() {
      this._check();
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
        out.push(o);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      this._check();
      if (!Array.isArray(vals) || vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) {
        throw new Error('The number of rows/columns in the data does not match the range.');
      }
      for (let i = 0; i < this.nr; i++) {
        const idx = this.r - 1 + i;
        while (this.sh.rows.length <= idx) this.sh.rows.push([]);
        for (let j = 0; j < this.nc; j++) this.sh.rows[idx][this.c - 1 + j] = coerce(vals[i][j]);
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat() { this._check(); return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
    protect() { return { setWarningOnly() { return this; } }; }
  }
  function coerce(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; }
    getName() { return this.name; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    getLastRow() {
      for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      return 0;
    }
    getLastColumn() {
      let m = 0;
      this.rows.forEach((row) => { for (let j = row.length - 1; j >= 0; j--) if (row[j] !== '' && row[j] !== undefined) { m = Math.max(m, j + 1); break; } });
      return m;
    }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    insertRowsAfter(after, n) { this.maxRows += n; }
    insertColumnsAfter(after, n) { this.maxCols += n; }
    deleteRow(r) { this.rows.splice(r - 1, 1); }
    setFrozenRows(n) { this.frozen = n; }
    appendRow(arr) { const r = this.getLastRow() + 1; this.getRange(r, 1, 1, arr.length).setValues([arr]); }
  }
  class Spreadsheet {
    constructor(id) { this.id = id; this.sheets = new Map(); this.insertSheet('Sheet1'); }
    getId() { return this.id; }
    getSheetByName(n) { return this.sheets.get(n) || null; }
    getSheets() { return [...this.sheets.values()]; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.set(n, s); return s; }
    deleteSheet(s) { this.sheets.delete(s.name); }
  }
  const spreadsheets = new Map();
  const SpreadsheetApp = {
    create(name) { const id = 'ss_' + crypto.randomBytes(6).toString('hex'); const s = new Spreadsheet(id); spreadsheets.set(id, s); return s; },
    openById(id) { const s = spreadsheets.get(id); if (!s) throw new Error('Spreadsheet not found: ' + id); return s; },
    getActiveSpreadsheet() { return null; },
  };

  /* ---------- DriveApp ---------- */
  let seq = 0;
  const nodes = new Map();
  class Folder {
    constructor(name, parent) {
      this.id = 'fo' + (++seq).toString(36) + crypto.randomBytes(4).toString('hex');
      this.name = name; this.parent = parent; this.folders = []; this.files = []; nodes.set(this.id, this);
      this.created = state.nowMs();
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getDateCreated() { return new Date(this.created); }
    createFolder(name) { const f = new Folder(name, this); this.folders.push(f); return f; }
    getFoldersByName(name) { return iter(this.folders.filter((f) => f.name === name)); }
    getFilesByName(name) { return iter(this.files.filter((f) => f.name === name)); }
    getFiles() { return iter(this.files.slice()); }
    createFile(blobOrName, content, mime) {
      if (state.driveFail && state.driveFail.createFile > 0 && --state.driveFail.createFile === 0) {
        throw new Error('Service error: Drive (注入された失敗)');
      }
      const blob = blobOrName instanceof Blob ? blobOrName : new Blob(content, mime, blobOrName);
      const f = new File(blob.getName() || blobOrName, blob, this);
      this.files.push(f);
      state.driveLog.push({ op: 'create', path: state.driveRel(f), fileId: f.id, lockHeld: state.lockHeld, at: state.nowIso() });
      return f;
    }
    path() { return this.parent ? [...this.parent.path(), this.name] : []; }
  }
  class File {
    constructor(name, blob, parent) {
      this.id = 'fi' + (++seq).toString(36) + crypto.randomBytes(4).toString('hex');
      this.name = name; this.blob = blob; this.parent = parent; this.sharing = null; this.trashed = false; nodes.set(this.id, this);
      this.created = state.nowMs();
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getBlob() { return new Blob(this.blob._buf, this.blob._ct, this.name); }
    getSize() { return this.blob._buf.length; }
    setSharing(access, perm) { this.sharing = { access, perm }; return this; }
    getDateCreated() { return new Date(this.created); }
    setTrashed(t) {
      if (t && !this.trashed) {
        state.driveLog.push({ op: 'trash', path: state.driveRel(this), fileId: this.id, lockHeld: state.lockHeld, at: state.nowIso() });
      }
      this.trashed = !!t;
      return this;
    }
    getUrl() {
      const p = this.parent.path();
      if (p.includes('reports')) return `${state.baseUrl}/files/reports/${encodeURIComponent(this.name)}`;
      return `https://drive.google.com/file/d/${this.id}/view`;
    }
  }
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  const driveRoot = new Folder('(root)', null);
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    createFolder(name) { return driveRoot.createFolder(name); },
    getFolderById(id) { const n = nodes.get(id); if (!n || !(n instanceof Folder)) throw new Error('No item with the given ID could be found'); return n; },
    getFileById(id) { const n = nodes.get(id); if (!n || !(n instanceof File)) throw new Error('No item with the given ID could be found'); return n; },
  };
  /** ルートフォルダからの相対パス(/__mock/drive と同じ表記) */
  state.driveRel = (f) => {
    const p = f.parent.path(); const i = p.indexOf(state.rootName);
    return [...p.slice(i + 1), f.name].join('/');
  };
  state.driveListPaths = (rootName) => {
    const out = [];
    const walk = (folder) => {
      folder.files.forEach((f) => { if (!f.trashed) { const p = f.parent.path(); const i = p.indexOf(rootName); out.push([...p.slice(i + 1), f.name].join('/')); } });
      folder.folders.forEach(walk);
    };
    walk(driveRoot);
    return out.sort();
  };
  state.driveFindFile = (name) => {
    let found = null;
    const walk = (folder) => {
      folder.files.forEach((f) => { if (f.name === name && f.parent.path().includes('reports')) found = f; });
      folder.folders.forEach(walk);
    };
    walk(driveRoot);
    return found;
  };

  /* ---------- Lock / Cache / Properties ---------- */
  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          // interleave: ロック外処理の完了後・ロック取得の直前に別リクエストの割り込みを再現する
          if (state.beforeScriptLock) { const f = state.beforeScriptLock; state.beforeScriptLock = null; f(); }
          state.lockWaits++;
          if (state.userLockHeld) state.lockOrderViolation++;
          if (state.lockHeld) throw new Error('Lock timeout: ロックを取得できませんでした');
          state.lockHeld = true;
        },
        tryLock() { if (state.lockHeld) return false; state.lockHeld = true; return true; },
        releaseLock() { state.lockHeld = false; },
        hasLock() { return state.lockHeld; },
      };
    },
    getUserLock() {
      return {
        waitLock() { if (state.userLockHeld) throw new Error('Lock timeout: ユーザーロックを取得できませんでした'); state.userLockHeld = true; },
        tryLock() { if (state.userLockHeld) return false; state.userLockHeld = true; return true; },
        releaseLock() { state.userLockHeld = false; },
        hasLock() { return state.userLockHeld; },
      };
    },
  };
  /* CacheService: 1値の上限は GAS と同じ 100KB(=102,400バイト、UTF-8)。TTL は仮想時計。最長6時間 */
  const CACHE_MAX_BYTES = 102400;
  const cacheMap = new Map();
  const isRef = (k) => String(k).startsWith('ref:');
  const cache = {
    get(k) {
      const e = cacheMap.get(k);
      if (e && e.exp <= state.nowMs()) cacheMap.delete(k);
      const live = e && e.exp > state.nowMs() ? e : null;
      if (isRef(k)) { if (live) state.cacheStats.hits++; else state.cacheStats.misses++; }
      return live ? live.v : null;
    },
    getAll(keys) { const o = {}; keys.forEach((k) => { const v = cache.get(k); if (v !== null) o[k] = v; }); return o; },
    put(k, v, ttl) {
      if (typeof v !== 'string') throw new Error('値は文字列のみ');
      if (String(k).length > 250) throw new Error('Argument too large: key');
      if (Buffer.byteLength(v, 'utf8') > CACHE_MAX_BYTES) {
        if (isRef(k)) state.cacheStats.skippedTooLarge++;
        throw new Error('Argument too large: value');
      }
      cacheMap.set(k, { v, exp: state.nowMs() + Math.min(ttl === undefined ? 600 : ttl, 21600) * 1000 });
    },
    remove(k) { cacheMap.delete(k); },
    removeAll(keys) { keys.forEach((k) => cacheMap.delete(k)); },
  };
  const CacheService = { getScriptCache: () => cache };
  state.cacheKeyList = () => [...cacheMap.keys()];
  state.cacheClearChunks = () => { for (const k of [...cacheMap.keys()]) if (k.startsWith('pc:') || k.startsWith('pt:')) cacheMap.delete(k); };
  /** 参照シートキャッシュ(ref:*)の一覧(期限切れを除く) */
  state.cacheRefEntries = () => {
    const now = state.nowMs();
    return [...cacheMap.entries()].filter(([k, e]) => isRef(k) && e.exp > now)
      .map(([k, e]) => ({ key: k, expiresAt: new Date(e.exp).toISOString(), _exp: e.exp }));
  };
  /** patch(keepCache) 用: ref:* を保存/復元(復元は「保存時点と完全に同じ」にする) */
  state.cacheRefSnapshot = () => [...cacheMap.entries()].filter(([k]) => isRef(k)).map(([k, e]) => [k, { v: e.v, exp: e.exp }]);
  state.cacheRefRestore = (snap) => {
    for (const k of [...cacheMap.keys()]) if (isRef(k)) cacheMap.delete(k);
    snap.forEach(([k, e]) => cacheMap.set(k, e));
  };
  const propMap = new Map();
  const props = {
    getProperty: (k) => (propMap.has(k) ? propMap.get(k) : null),
    setProperty(k, v) { propMap.set(k, String(v)); return props; },
    getProperties() { return Object.fromEntries(propMap); },
    deleteProperty(k) { propMap.delete(k); return props; },
  };
  const PropertiesService = { getScriptProperties: () => props };

  /* ---------- その他 ---------- */
  const ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(text) {
      const o = { _t: text, _m: 'TEXT', setMimeType(m) { o._m = m; return o; }, getContent() { return o._t; }, getMimeType() { return o._m; } };
      return o;
    },
  };
  const MailApp = {
    sendEmail(a, b, c) {
      const m = typeof a === 'object' ? { to: a.to, subject: a.subject, body: a.body } : { to: a, subject: b, body: c };
      state.mails.push(Object.assign(m, { at: state.nowIso() }));
    },
    getRemainingDailyQuota: () => 100,
  };
  const HtmlService = {
    createHtmlOutput(html) {
      return { getBlob() { return new HtmlBlob(Buffer.from(html, 'utf8'), 'text/html', 'report.html'); }, getContent: () => html };
    },
  };
  const Session = {
    getScriptTimeZone: () => 'Asia/Tokyo',
    getActiveUser() { throw new Error('Session.getActiveUser は使用禁止(SPEC §1.3)'); },
  };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger(t) { state.triggers = state.triggers.filter((x) => x !== t); },
    newTrigger(fn) {
      const b = { _fn: fn };
      const chain = () => b;
      b.timeBased = chain; b.everyMinutes = chain; b.atHour = chain; b.everyDays = chain; b.inTimezone = chain; b.nearMinute = chain;
      b.create = () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; };
      return b;
    },
  };
  const Logger = { log: (m) => { state.loggerLines.push(String(m)); } };
  const con = {
    log: (...a) => state.logs.push(a.join(' ')),
    error: (...a) => state.logs.push(a.join(' ')),
    warn: (...a) => state.logs.push(a.join(' ')),
    info: (...a) => state.logs.push(a.join(' ')),
  };

  return {
    globals: { Utilities, SpreadsheetApp, DriveApp, LockService, CacheService, PropertiesService, ContentService, MailApp, HtmlService, Session, ScriptApp, Logger, console: con },
    createSpreadsheet: () => SpreadsheetApp.create('harness'),
  };
}

module.exports = { createShims };
