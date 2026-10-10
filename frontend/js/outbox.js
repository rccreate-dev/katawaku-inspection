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

  /* 写真の同時送信数: 整数として受け取り1〜6に収める。欠落/null/0以下は1(SPEC §8.4-0) */
  function normParallel(v) {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1) return 1; // 欠落/null/0以下/小数/文字列は1(丸めない)
    return Math.min(6, v);
  }
  function isPhotoRow(r) { return r.action === 'uploadPhotoChunk'; }

  /*
   * 送信可否規則(SPEC §8.4-1)。いま送ってよい行の seq 配列を返す純関数。
   * rows: outboxの全行 / opts: {now, photoParallel}
   *  (a) 非写真の行は全体で同時に1件 (b) 写真の行は全体で同時に P 件
   *  (c) 同じ recordId では、写真の行は先行する未完了の非写真の行があるうちは送らない。
   *      非写真の行は先行する未完了の行(写真・非写真とも)があるうちは送らない。stopPour は他の行の判定に数えず、他の行も待たない
   *  (d) 同じ photoId は同時に1件
   * 未完了 = rows に残っている行(pending/sending/failed/blocked)。成功した行は削除済みでここに無い
   */
  function selectSendable(rows, opts) {
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    var P = normParallel(opts.photoParallel);
    var photoActive = 0, nonPhotoActive = 0, pids = {};
    rows.forEach(function (r) {
      if (r.status !== 'sending') return;
      if (isPhotoRow(r)) { photoActive++; if (r.photo && r.photo.photoId) pids[r.photo.photoId] = 1; }
      else nonPhotoActive++;
    });
    var cands = rows.filter(function (r) { return r.status === 'pending' && (r.nextTryAt || 0) <= now; })
      .sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || a.seq - b.seq; });
    var out = [];
    cands.forEach(function (r) {
      var prior = (r.recordId && r.action !== 'stopPour')
        ? rows.filter(function (o) { return o.recordId === r.recordId && o.seq < r.seq && o.action !== 'stopPour'; })
        : [];
      if (isPhotoRow(r)) {
        if (photoActive >= P) return;
        if (prior.some(function (o) { return !isPhotoRow(o); })) return;
        var pid = r.photo && r.photo.photoId;
        if (pid && pids[pid]) return;
        photoActive++;
        if (pid) pids[pid] = 1;
        out.push(r.seq);
      } else {
        if (nonPhotoActive >= 1) return;
        if (prior.length) return;
        nonPhotoActive++;
        out.push(r.seq);
      }
    });
    return out;
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
  /* 送信行の選択と pending → sending を同じトランザクションで行う(SPEC §8.3 不変条件5)。
   * その時点の全行に対して selectSendable を評価するので、並行する複数スロットが同じ行・同じ photoId・規則違反の行を取らない。
   * 返す行は更新後(sending)の読み直した内容(統合後の params/clientId。不変条件1) */
  function claimSendable(opts) {
    return db().tx(['outbox'], 'readwrite', function (s) {
      return db().reqP(s.outbox.getAll()).then(function (rows) {
        var seqs = selectSendable(rows, opts);
        var picked = rows.filter(function (r) { return seqs.indexOf(r.seq) >= 0; });
        return Promise.all(picked.map(function (r) {
          r.status = 'sending';
          return db().reqP(s.outbox.put(r));
        })).then(function () { return picked; });
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
  /* 確定失敗の影響範囲(SPEC §8.4-4)。非写真の行が失敗 → 同じ記録の後続の全ての pending 行。
   * 写真の行が失敗(afterSeq 指定) → 同じ記録の、それより後の非写真の pending 行だけ(他の写真の行は止めない) */
  function blockRecord(recordId, exceptSeq, photoFailed) {
    return all().then(function (rows) {
      return Promise.all(rows.filter(function (r) {
        if (r.recordId !== recordId || r.seq === exceptSeq || r.status !== 'pending') return false;
        if (r.action === 'stopPour') return false; // 打設停止は他の行の失敗で保留にしない(§8.4(e))
        if (photoFailed) return r.seq > exceptSeq && !isPhotoRow(r);
        return true;
      }).map(function (r) {
        return update(r.seq, function (x) { if (x.status === 'pending') { x.status = 'blocked'; x.blockReason = 'record'; } });
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
    backoffSec: backoffSec, classify: classify, mergeParams: mergeParams, pickNext: pickNext, selectSendable: selectSendable, normParallel: normParallel, isExpired: isExpired,
    enqueue: enqueue, all: all, forRecord: forRecord, update: update, claim: claim, claimSendable: claimSendable, remove: remove,
    blockAll: blockAll, unblock: unblock, blockRecord: blockRecord, unblockRecord: unblockRecord, recoverSending: recoverSending
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KW.outbox;
})(typeof window !== 'undefined' ? window : globalThis);
