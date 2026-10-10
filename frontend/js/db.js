/* db.js: IndexedDB(DB名 katawaku v1。SPEC §8.2)
 * iOS Safari(WebKit)は Blob/File を IndexedDB へ直接保存すると失敗することがある
 * (Error preparing Blob/File data to be stored in object store)。そこで photoBlobs / photoCache の値の
 * 直下の Blob は {__ab: ArrayBuffer, __type} にして保存し、読み出し時に Blob へ戻す。旧形式(Blob のまま)もそのまま読める。 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var DB_NAME = 'katawaku', DB_VERSION = 1;
  var dbp = null;
  var BLOB_STORES = { photoBlobs: 1, photoCache: 1 };

  /* ---- Blob <-> ArrayBuffer(純関数。Node のユニットテストからも使う) ---- */
  function isBlob(v) { return typeof Blob !== 'undefined' && v instanceof Blob; }
  function blobToArrayBuffer(b) {
    if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
    return new Promise(function (resolve, reject) { // 古い環境: FileReader
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(b);
    });
  }
  /* 値の直下(1階層)の Blob を {__ab, __type} に置き換えた複製を返す */
  function encodeBlobs(val) {
    if (!val || typeof val !== 'object') return Promise.resolve(val);
    var out = Object.assign({}, val);
    return Promise.all(Object.keys(out).map(function (k) {
      if (!isBlob(out[k])) return null;
      var type = out[k].type || '';
      return blobToArrayBuffer(out[k]).then(function (ab) { out[k] = { __ab: ab, __type: type }; });
    })).then(function () { return out; });
  }
  /* {__ab, __type} を Blob に戻す(Blob のまま保存された旧データはそのまま) */
  function decodeBlobs(val) {
    if (!val || typeof val !== 'object') return val;
    Object.keys(val).forEach(function (k) {
      var v = val[k];
      if (v && typeof v === 'object' && !isBlob(v) && v.__ab != null) val[k] = new Blob([v.__ab], { type: v.__type || '' });
    });
    return val;
  }

  function reqP(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        db.createObjectStore('kv', { keyPath: 'k' });
        var rec = db.createObjectStore('records', { keyPath: 'recordId' });
        rec.createIndex('siteId', 'siteId', { unique: false });
        db.createObjectStore('drafts', { keyPath: 'recordId' });
        var ob = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        ob.createIndex('status', 'status', { unique: false });
        ob.createIndex('recordId', 'recordId', { unique: false });
        db.createObjectStore('photoBlobs', { keyPath: 'photoId' });
        db.createObjectStore('photoCache', { keyPath: 'photoId' });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        db.onversionchange = function () { db.close(); dbp = null; };
        resolve(db);
      };
      rq.onerror = function () { reject(rq.error); };
      rq.onblocked = function () { reject(new Error('IDB_BLOCKED')); };
    });
    return dbp;
  }

  /* fn(stores) 内で IDB リクエストだけを await すること */
  function tx(names, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(names, mode);
        var stores = {};
        names.forEach(function (n) { stores[n] = t.objectStore(n); });
        var result;
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('IDB_ABORT')); };
        Promise.resolve().then(function () { return fn(stores); }).then(function (r) { result = r; }, function (e) { try { t.abort(); } catch (x) { /* 無視 */ } reject(e); });
      });
    });
  }

  function get(store, key) {
    return tx([store], 'readonly', function (s) { return reqP(s[store].get(key)); }).then(function (r) { return BLOB_STORES[store] ? decodeBlobs(r) : r; });
  }
  function put(store, val) {
    function write(v) { return tx([store], 'readwrite', function (s) { return reqP(s[store].put(v)); }); }
    if (!BLOB_STORES[store]) return write(val);
    // 変換は IDB トランザクションの外で済ませる(トランザクション中に非IDBの待ちを入れない)
    return encodeBlobs(val).then(write).catch(function (e) {
      if (!/blob|file/i.test(String(e && e.message))) throw e;
      return encodeBlobs(val).then(write); // Blob 関連の失敗は ArrayBuffer 方式でもう一度だけ試す
    });
  }
  function del(store, key) { return tx([store], 'readwrite', function (s) { return reqP(s[store].delete(key)); }); }
  function all(store) {
    return tx([store], 'readonly', function (s) { return reqP(s[store].getAll()); }).then(function (rows) { return BLOB_STORES[store] ? rows.map(decodeBlobs) : rows; });
  }
  function clear(store) { return tx([store], 'readwrite', function (s) { return reqP(s[store].clear()); }); }
  function clearAll() {
    var names = ['kv', 'records', 'drafts', 'outbox', 'photoBlobs', 'photoCache'];
    return tx(names, 'readwrite', function (s) { return Promise.all(names.map(function (n) { return reqP(s[n].clear()); })); });
  }
  function kvGet(k) { return get('kv', k).then(function (r) { return r ? r.v : undefined; }); }
  function kvSet(k, v) { return put('kv', { k: k, v: v }); }
  function kvDel(k) { return del('kv', k); }

  KW.db = { open: open, tx: tx, reqP: reqP, get: get, put: put, del: del, all: all, clear: clear, clearAll: clearAll, kvGet: kvGet, kvSet: kvSet, kvDel: kvDel, encodeBlobs: encodeBlobs, decodeBlobs: decodeBlobs, blobToArrayBuffer: blobToArrayBuffer };
  if (typeof module !== 'undefined' && module.exports) module.exports = KW.db;
})(typeof window !== 'undefined' ? window : globalThis);
