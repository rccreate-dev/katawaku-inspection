/* sync.js: 送信ループ・ポーリング・オンライン状態(SPEC §8.4/§8.9) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};

  var running = false, again = false, idleWaiters = [], timer = null, pollTimer = null;
  var lastBootstrapAt = 0;

  function canSend() { return !!KW.state.token && KW.isOnline() && !KW.state.outdated; }

  function setOnline(v) {
    if (KW.state.online !== v) { KW.state.online = v; KW.bus.emit('net:changed', v); }
  }

  /* 件数の更新 */
  function refreshCounts() {
    return KW.outbox.all().then(function (rows) {
      KW.state.outboxCount = rows.length;
      KW.state.outboxBad = rows.filter(function (r) { return r.status === 'failed' || r.status === 'blocked'; }).length;
      // 打設停止が未送信のまま残っているか(消えない警告バナー用。確定失敗の行は除く)
      KW.state.stopQueued = rows.filter(function (r) { return r.action === 'stopPour' && r.status !== 'failed'; }).length;
      KW.bus.emit('outbox:counts');
      return rows;
    });
  }

  function scheduleNext(rows) {
    if (timer) { clearTimeout(timer); timer = null; }
    var now = Date.now();
    var next = null;
    rows.forEach(function (r) { if (r.status === 'pending' && (r.nextTryAt || 0) > now) next = next == null ? r.nextTryAt : Math.min(next, r.nextTryAt); });
    if (next != null) timer = setTimeout(kick, Math.max(500, next - now));
  }

  /* 写真チャンク1つを送る */
  function sendPhotoChunk(row) {
    return KW.db.get('photoBlobs', row.photo.photoId).then(function (pb) {
      if (!pb) return { ok: false, error: { code: 'NOT_FOUND', message: 'local photo missing' } };
      var chars = (KW.state.bootstrap && KW.state.bootstrap.config && KW.state.bootstrap.config.photoChunkChars) || 90000;
      return KW.photo.chunksOf(pb.full, chars).then(function (chunks) {
        var idx = Math.min(row.photo.nextIndex || 0, chunks.length - 1);
        var m = pb.meta;
        var params = {
          photoId: row.photo.photoId, recordId: row.params.recordId, side: row.params.side,
          index: idx, total: chunks.length, mime: 'image/jpeg', data: chunks[idx],
          takenAt: m.takenAt, width: m.width, height: m.height, bytes: m.bytes, sha256: m.sha256, stampText: m.stampText
        };
        if (row.params.itemId) params.itemId = row.params.itemId;
        if (idx === 0) return KW.photo.blobToB64(pb.thumb).then(function (tb) { params.thumb = tb; return KW.api.call('uploadPhotoChunk', params, { timeoutMs: 60000 }); });
        return KW.api.call('uploadPhotoChunk', params, { timeoutMs: 60000 });
      });
    });
  }

  function afterSuccess(row, res) {
    var d = res.data || {};
    var chain = Promise.resolve();
    if (row.action === 'createRecord' && d.record) chain = KW.data.putDetail(d.record);
    else if (d.record && d.record.recordId) chain = KW.data.mergeSummary(d.record);
    else if (row.action === 'addNote' && d.note) {
      chain = KW.data.getRow(row.recordId).then(function (r) {
        if (r && r.detail) { r.detail.notes = (r.detail.notes || []).concat([d.note]); return KW.db.put('records', r); }
        return null;
      });
    }
    return chain;
  }

  /* 写真の送信完了(FE-03)。順序: 詳細を再取得 → 行を削除 → 端末の写真本体を削除 → photo:done。
   * 本体の削除を詳細(サーバーの写真一覧)の更新より後にするので、画面側の検証で「写真0枚」に見える隙間ができない。
   * (検証側は 写真本体 → 詳細キャッシュ の順に読むこと。本体が無ければ、詳細は更新済み)
   * 詳細を取れなかったときは本体を uploadState='uploaded' で残し、詳細に載った時点で data.putDetail が片付ける */
  function finishPhoto(row, pid) {
    var rid = row.recordId;
    var fresh = false;
    return KW.data.loadDetail(rid).then(function (r) { fresh = !!(r && r.detail && !r.cached); }, function () { fresh = false; })
      .then(function () { return KW.outbox.remove(row.seq); })
      .then(function () { return KW.db.get('photoBlobs', pid); })
      .then(function (pb) {
        if (!pb) return null;
        var th = pb.thumb;
        var done = function () { return th ? KW.data.cacheThumb(pid, th) : null; };
        if (!fresh) { pb.uploadState = 'uploaded'; return KW.db.put('photoBlobs', pb).then(done); }
        return KW.data.delPhotoBlob(pid).then(done);
      })
      .then(function () { KW.bus.emit('photo:done', rid, pid); });
  }

  function step() {
    if (!canSend()) return Promise.resolve(false);
    return KW.outbox.all().then(function (rows) {
      var now = Date.now();
      // 30日超は期限切れ(failed)
      var expired = rows.filter(function (r) { return (r.status === 'pending' || r.status === 'blocked') && KW.outbox.isExpired(r, now); });
      var chain = Promise.all(expired.map(function (r) {
        return KW.outbox.update(r.seq, function (x) { x.status = 'failed'; x.blockReason = null; x.lastError = { code: 'EXPIRED', message: 'expired' }; });
      }));
      return chain.then(function () { return expired.length ? KW.outbox.all() : rows; });
    }).then(function (rows) {
      var row = KW.outbox.pickNext(rows, Date.now());
      if (!row) { scheduleNext(rows); return false; }
      // pending→sending と同じトランザクションで行を読み直し、統合後の内容を送る(H1)
      return KW.outbox.claim(row.seq).then(function (fresh) { return fresh ? send(fresh) : true; });
    });
  }

  function send(row) {
    var isPhoto = row.action === 'uploadPhotoChunk';
    var p = isPhoto ? sendPhotoChunk(row) : KW.api.call(row.action, row.params, { clientId: row.clientId });
    return p.then(function (res) { return handle(row, res, isPhoto); });
  }

  function handle(row, res, isPhoto) {
    if (res.ok) {
      if (isPhoto && !res.data.complete) {
        return KW.outbox.update(row.seq, function (x) { x.status = 'pending'; x.photo.nextIndex = (x.photo.nextIndex || 0) + 1; x.tries = 0; }).then(function () { return true; });
      }
      var pid = isPhoto ? row.photo.photoId : null;
      return afterSuccess(row, res).then(function () {
        return pid ? finishPhoto(row, pid) : KW.outbox.remove(row.seq);
      }).then(function () { setOnline(true); return refreshCounts().then(function () { return true; }); });
    }
    // 失敗
    var code = res.error && res.error.code;
    var kind = res.network ? 'retry' : KW.outbox.classify(code);
    if (kind === 'retry') {
      return KW.outbox.update(row.seq, function (x) {
        x.status = 'pending'; x.tries = (x.tries || 0) + 1;
        x.nextTryAt = Date.now() + KW.outbox.backoffSec(x.tries) * 1000;
        x.lastError = { code: code || 'NETWORK', message: res.error && res.error.message };
      }).then(function () {
        if (res.network && KW.state.netFails >= 3) setOnline(false);
        return refreshCounts().then(function (rows) { scheduleNext(rows); return !res.network; });
      });
    }
    if (kind === 'chunk') {
      return KW.outbox.update(row.seq, function (x) { x.status = 'pending'; x.photo.nextIndex = 0; x.nextTryAt = 0; }).then(function () { return true; });
    }
    if (kind === 'auth' || kind === 'locked' || kind === 'disabled' || kind === 'outdated') {
      // 行は保持。全行を保留にし、認証等が復帰したら再開(global handlerが画面遷移)
      var reason = kind === 'locked' ? 'locked' : (kind === 'outdated' ? 'outdated' : 'auth');
      return KW.outbox.update(row.seq, function (x) { x.status = 'pending'; x.lastError = { code: code }; })
        .then(function () { return KW.outbox.blockAll(reason); })
        .then(refreshCounts).then(function () { return false; });
    }
    // 確定エラー
    return KW.outbox.update(row.seq, function (x) {
      x.status = 'failed';
      x.lastError = { code: code, message: res.error && res.error.message, data: res.error && res.error.data };
    }).then(function () {
      return row.recordId ? KW.outbox.blockRecord(row.recordId, row.seq) : null;
    }).then(refreshCounts).then(function () {
      KW.bus.emit('outbox:failed', row.recordId, code);
      return true;
    });
  }

  function loop() {
    if (running) { again = true; return flushPromise(); }
    running = true;
    var cycle = function () {
      again = false;
      var go = function () {
        return step().then(function (cont) { return cont ? go() : null; });
      };
      return go().then(function () { if (again) return cycle(); return null; });
    };
    return cycle().catch(function (e) { KW.reportError(e); }).then(function () {
      running = false;
      return refreshCounts();
    }).then(function (rows) {
      scheduleNext(rows);
      var w = idleWaiters; idleWaiters = [];
      w.forEach(function (f) { f(); });
    });
  }
  function flushPromise() { return new Promise(function (r) { idleWaiters.push(r); }); }
  function kick() { return loop(); }

  /* 送信を走らせ、終わるまで待つ */
  function flush() {
    if (!canSend()) return refreshCounts().then(function () { return null; });
    var p = flushPromise();
    kick();
    return p;
  }

  /* キューに積んで送信を試み、結果を返す: {ok, error?, queued?}。確定エラーの行は取り除く */
  function runQueued(action, params, o) {
    o = o || {};
    return KW.outbox.enqueue(action, params, o).then(function (seq) {
      var p = KW.isOnline() ? flush() : Promise.resolve();
      return p.then(function () { return KW.outbox.all(); }).then(function (rows) {
        var row = rows.filter(function (r) { return r.seq === seq; })[0];
        if (!row) return { ok: true };
        if (row.status === 'failed') {
          return KW.outbox.remove(seq).then(function () { return row.recordId ? KW.outbox.unblockRecord(row.recordId) : null; })
            .then(function () { return { ok: false, error: row.lastError }; });
        }
        return { ok: true, queued: true };
      });
    });
  }

  /* 認証が復帰したときの再開 */
  function resumeAfterAuth(sameUser) {
    var p = sameUser ? KW.outbox.unblock(['auth', 'locked', 'outdated']) : Promise.resolve();
    return p.then(function () { return refreshCounts(); }).then(kick);
  }

  /* ---- ポーリング ---- */
  function bootstrap(force) {
    if (!KW.isOnline() || !KW.state.token) return Promise.resolve(false);
    if (!force && Date.now() - lastBootstrapAt < 5 * 60 * 1000) return Promise.resolve(false);
    return KW.api.call('getBootstrap', {}).then(function (res) {
      if (!res.ok) return false;
      lastBootstrapAt = Date.now();
      var b = res.data;
      var prev = KW.state.bootstrap;
      KW.state.bootstrap = { sites: b.sites, items: b.items, itemsHash: b.itemsHash, config: b.config, fetchedAt: Date.now() };
      KW.state.me = b.user || KW.state.me;
      return KW.db.kvSet('bootstrap', KW.state.bootstrap).then(function () {
        KW.db.kvSet('me', KW.state.me);
        KW.bus.emit('bootstrap:changed', !prev || prev.itemsHash !== b.itemsHash);
        return true;
      });
    });
  }

  function pollOnce() {
    if (!KW.state.token || !KW.isOnline() || document.visibilityState === 'hidden') return Promise.resolve();
    return KW.api.call('me', {}).then(function (res) {
      if (res.ok) {
        var prev = KW.state.me;
        KW.state.me = res.data.user;
        if (prev && prev.status === 'locked' && res.data.user.status === 'active') {
          KW.bus.emit('auth:unlocked');
          resumeAfterAuth(true);
        }
        if (res.data.user.status === 'locked') { KW.bus.emit('auth:error', 'USER_LOCKED', { code: 'USER_LOCKED' }); return null; }
        return KW.data.syncRecords().then(function () {
          KW.bus.emit('poll:done');
          return bootstrap(false);
        });
      }
      return null;
    });
  }
  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    var sec = (KW.state.bootstrap && KW.state.bootstrap.config && KW.state.bootstrap.config.pollIntervalSec) || 60;
    pollTimer = setInterval(function () { pollOnce(); kick(); }, sec * 1000);
  }

  function start() {
    // 起動時: 送信中のまま残った行を戻し、CLIENT_OUTDATED で保留した行は自動で再開(更新後のリロード。SPEC §8.10)
    refreshCounts(); // まず件数だけ即反映(起動直後のバッジ)
    KW.outbox.recoverSending().then(function () { return KW.outbox.unblock(['outdated']); }).then(refreshCounts).then(function () { kick(); });
    window.addEventListener('online', function () { setOnline(true); KW.state.netFails = 0; kick(); pollOnce(); });
    window.addEventListener('offline', function () { setOnline(false); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { kick(); pollOnce(); bootstrap(false); }
    });
    setInterval(kick, 30000);
    schedulePoll();
    KW.bus.on('bootstrap:changed', schedulePoll);
    KW.bus.on('outbox:changed', function () { refreshCounts(); if (!running) kick(); });
  }

  KW.sync = { runQueued: runQueued, kick: kick, flush: flush, refreshCounts: refreshCounts, resumeAfterAuth: resumeAfterAuth, bootstrap: bootstrap, pollOnce: pollOnce, start: start, setOnline: setOnline, canSend: canSend };
})(window);
