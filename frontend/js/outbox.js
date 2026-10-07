/* outbox.js: 送信待ちキュー(SPEC §8.3〜§8.5)。純関数部分はユニットテスト可能 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};

  var BACKOFF_SEC = [2, 5, 15, 30, 60];
  var EXPIRE_MS = 30 * 24 * 3600 * 1000;
  var MERGE_ACTIONS = { saveDraft: 1, saveQaDraft: 1 };
  var RETRY_CODES = { LOCK_TIMEOUT: 1, INTERNAL: 1, DRIVE_ERROR: 1, NETWORK: 1 };
  var HARD_CODES = {
    RECORD_LOCKED: 1, STATE_CONFLICT: 1, FORBIDDEN_ROLE: 1, FORBIDDEN_SITE: 1, FORBIDDEN_TEAM: 1, NOT_FOUND: 1,
    VALIDATION_FAILED: 1, ALREADY_EXISTS: 1, PHOTO_INVALID: 1, PHOTO_LIMIT: 1, PHOTO_TOO_LARGE: 1,
    NOT_CLAIMER: 1, NOT_CLAIMED: 1, IDEMPOTENCY_CONFLICT: 1, BAD_REQUEST: 1, STAGE_NOT_ENABLED: 1, SITE_CLOSED: 1
  };

  /* バックオフ秒: tries(失敗回数, 1始まり) -> 2,5,15,30,60,60... */
  function backoffSec(tries) {
    var i = Math.max(1, tries) - 1;
    return BACKOFF_SEC[Math.min(i, BACKOFF_SEC.length - 1)];
  }

  /* エラーの扱い: retry | auth | locked | disabled | outdated | chunk | fail */
  function classify(code) {
    if (RETRY_CODES[code]) return 'retry';
    if (code === 'UNAUTHENTICATED' || code === 'DEVICE_REVOKED') return 'auth';
    if (code === 'USER_LOCKED') return 'locked';
    if (code === 'USER_DISABLED') return 'disabled';
    if (code === 'CLIENT_OUTDATED') return 'outdated';
    if (code === 'CHUNK_MISSING') return 'chunk';
    return 'fail';
  }

  /* saveDraft / saveQaDraft の統合(同一recordIdのpendingへ新しい変更をマージ) */
  function mergeParams(oldP, newP) {
    var out = JSON.parse(JSON.stringify(oldP));
    if (newP.header) out.header = Object.assign({}, out.header || {}, newP.header);
    if (newP.comment !== undefined) out.comment = newP.comment;
    if (newP.items) {
      var map = {};
      (out.items || []).forEach(function (p) { map[p.itemId] = p; });
      newP.items.forEach(function (p) { map[p.itemId] = Object.assign({}, map[p.itemId] || {}, p); });
      out.items = Object.keys(map).map(function (k) { return map[k]; });
    }
    return out;
  }

  /* 次に送る行: pending かつ nextTryAt<=now。優先度(1が先)→seq。同一recordIdは先行行が残る間は送らない(stopPour除く) */
  function pickNext(rows, now) {
    var cands = rows.filter(function (r) { return r.status === 'pending' && (r.nextTryAt || 0) <= now; });
    var ok = cands.filter(function (r) {
      if (r.priority === 1 || !r.recordId) return true;
      return !rows.some(function (o) { return o.seq < r.seq && o.recordId === r.recordId; });
    });
    ok.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || a.seq - b.seq; });
    return ok[0] || null;
  }

  function isExpired(row, now) { return now - (row.createdAt || now) > EXPIRE_MS; }

  /* ---- 永続化操作(IndexedDB) ---- */
  function db() { return KW.db; }

  function newRow(action, params, o) {
    return {
      clientId: o.clientId || KW.newClientId(),
      action: action, params: params, priority: o.priority || 0,
      recordId: o.recordId || null, status: 'pending', tries: 0, nextTryAt: 0,
      createdAt: Date.now(), lastError: null, photo: o.photo || null
    };
  }

  function changed() { KW.bus.emit('outbox:changed'); }

  /* 通常の追加。MERGE_ACTIONS は同一recordIdのpendingへマージ(clientIdは新規採番) */
  function enqueue(action, params, o) {
    o = o || {};
    return db().tx(['outbox'], 'readwrite', function (s) {
      var os = s.outbox;
      if (MERGE_ACTIONS[action] && o.recordId) {
        return db().reqP(os.index('recordId').getAll(o.recordId)).then(function (rows) {
          var cand = rows.filter(function (r) { return r.action === action && r.status === 'pending'; })
            .sort(function (a, b) { return b.seq - a.seq; })[0];
          if (cand) {
            cand.params = mergeParams(cand.params, params);
            cand.clientId = KW.newClientId();
            return db().reqP(os.put(cand)).then(function () { return cand.seq; });
          }
          return db().reqP(os.add(newRow(action, params, o)));
        });
      }
      return db().reqP(os.add(newRow(action, params, o)));
    }).then(function (seq) { changed(); return seq; });
  }

  function all() {
    return db().all('outbox').then(function (rows) { return rows.sort(function (a, b) { return a.seq - b.seq; }); });
  }
  function forRecord(recordId) { return all().then(function (rows) { return rows.filter(function (r) { return r.recordId === recordId; }); }); }
  function update(seq, fn) {
    return db().tx(['outbox'], 'readwrite', function (s) {
      return db().reqP(s.outbox.get(seq)).then(function (row) {
        if (!row) return null;
        fn(row);
        return db().reqP(s.outbox.put(row)).then(function () { return row; });
      });
    });
  }
  /* pending → sending に更新すると同時に、その時点の行を読み直して返す(SPEC §8.3 不変条件1)。
   * 統合(enqueue)が先に入っていれば統合後の params/clientId を返す。pending でなければ null */
  function claim(seq) {
    return db().tx(['outbox'], 'readwrite', function (s) {
      return db().reqP(s.outbox.get(seq)).then(function (row) {
        if (!row || row.status !== 'pending') return null;
        row.status = 'sending';
        return db().reqP(s.outbox.put(row)).then(function () { return row; });
      });
    });
  }
  function remove(seq) { return db().del('outbox', seq).then(changed); }

  /* ブロックの掛け外し */
  function blockAll(reason) {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.status === 'pending' || r.status === 'sending'; }).map(function (r) {
        return update(r.seq, function (x) { x.status = 'blocked'; x.blockReason = reason; });
      }));
    }).then(changed);
  }
  function unblock(reasons) {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.status === 'blocked' && reasons.indexOf(r.blockReason) >= 0; }).map(function (r) {
        return update(r.seq, function (x) { x.status = 'pending'; x.blockReason = null; x.nextTryAt = 0; });
      }));
    }).then(changed);
  }
  function blockRecord(recordId, exceptSeq) {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.recordId === recordId && r.seq !== exceptSeq && r.status === 'pending'; }).map(function (r) {
        return update(r.seq, function (x) { x.status = 'blocked'; x.blockReason = 'record'; });
      }));
    });
  }
  function unblockRecord(recordId) {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.recordId === recordId && r.status === 'blocked' && r.blockReason === 'record'; }).map(function (r) {
        return update(r.seq, function (x) { x.status = 'pending'; x.blockReason = null; x.nextTryAt = 0; });
      }));
    });
  }
  /* sending のまま残った行(アプリ強制終了など)を pending に戻す */
  function recoverSending() {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.status === 'sending'; }).map(function (r) {
        return update(r.seq, function (x) { x.status = 'pending'; });
      }));
    });
  }

  KW.outbox = {
    BACKOFF_SEC: BACKOFF_SEC, EXPIRE_MS: EXPIRE_MS,
    backoffSec: backoffSec, classify: classify, mergeParams: mergeParams, pickNext: pickNext, isExpired: isExpired,
    enqueue: enqueue, all: all, forRecord: forRecord, update: update, claim: claim, remove: remove,
    blockAll: blockAll, unblock: unblock, blockRecord: blockRecord, unblockRecord: unblockRecord, recoverSending: recoverSending
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KW.outbox;
})(typeof window !== 'undefined' ? window : globalThis);
