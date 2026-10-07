/* db.js: IndexedDB(DB名 katawaku v1。SPEC §8.2) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var DB_NAME = 'katawaku', DB_VERSION = 1;
  var dbp = null;

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

  function get(store, key) { return tx([store], 'readonly', function (s) { return reqP(s[store].get(key)); }); }
  function put(store, val) { return tx([store], 'readwrite', function (s) { return reqP(s[store].put(val)); }); }
  function del(store, key) { return tx([store], 'readwrite', function (s) { return reqP(s[store].delete(key)); }); }
  function all(store) { return tx([store], 'readonly', function (s) { return reqP(s[store].getAll()); }); }
  function clear(store) { return tx([store], 'readwrite', function (s) { return reqP(s[store].clear()); }); }
  function clearAll() {
    var names = ['kv', 'records', 'drafts', 'outbox', 'photoBlobs', 'photoCache'];
    return tx(names, 'readwrite', function (s) { return Promise.all(names.map(function (n) { return reqP(s[n].clear()); })); });
  }
  function kvGet(k) { return get('kv', k).then(function (r) { return r ? r.v : undefined; }); }
  function kvSet(k, v) { return put('kv', { k: k, v: v }); }
  function kvDel(k) { return del('kv', k); }

  KW.db = { open: open, tx: tx, reqP: reqP, get: get, put: put, del: del, all: all, clear: clear, clearAll: clearAll, kvGet: kvGet, kvSet: kvSet, kvDel: kvDel };
})(window);
