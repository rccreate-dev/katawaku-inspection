/* sync.js: 送信ループ・ポーリング・オンライン状態(SPEC §8.4/§8.9) */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};

  // スケジューラ(行を選ぶ処理)は同時に1本。送信中の要求は inflight 件まで並行(SPEC §8.4)
  var scheduling = false, again = false, recovering = false, inflight = 0, idleWaiters = [], timer = null, pollTimer = null;
  var lastBootstrapAt = 0;

  function canSend() { return !!KW.state.token && KW.isOnline() && !KW.state.outdated; }

  function setOnline(v) {
    if (KW.state.online !== v) { KW.state.online = v; KW.bus.emit('net:changed', v); }
  }

  /* 件数の更新 */
  function refreshCounts() {
    return KW.outbox.all().then(function (rows) {
      KW.state.outboxCount = rows.length;
      KW.state.sendingPhotos = {};
      rows.forEach(function (r) { if (r.action === 'uploadPhotoChunk' && r.status === 'sending' && r.photo) KW.state.sendingPhotos[r.photo.photoId] = 1; });
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

  /* 写真1リクエストを送る。送信直前(nextIndex=0)に最新の bootstrap.config で単発/分割を決める(SPEC §7.3-6) */
  function sendPhotoChunk(row) {
    return KW.db.get('photoBlobs', row.photo.photoId).then(function (pb) {
      if (!pb) return { ok: false, error: { code: 'NOT_FOUND', message: 'local photo missing' } };
      var cfg = (KW.state.bootstrap && KW.state.bootstrap.config) || {};
      return KW.photo.blobToB64(pb.full).then(function (b64) {
        var next = row.photo.nextIndex || 0;
        // 分割に入った後(nextIndex>0)は方式を変えない
        var plan = KW.photo.planUpload(b64, cfg, next > 0 ? row.photo.total : null);
        if (plan.tooLarge) return { ok: false, error: { code: 'PHOTO_TOO_LARGE', message: 'photo too large' } };
        var idx = next;
        // 分割サイズが変わって総数が合わなくなったときは最初から送り直す
        if (next > 0 && plan.total !== row.photo.total) idx = 0;
        idx = Math.min(idx, plan.total - 1);
        var save = (plan.total !== row.photo.total || idx !== next)
          ? KW.outbox.update(row.seq, function (x) { x.photo.total = plan.total; x.photo.nextIndex = idx; })
          : Promise.resolve();
        return save.then(function () {
          var m = pb.meta;
          var params = {
            photoId: row.photo.photoId, recordId: row.params.recordId, side: row.params.side,
            index: idx, total: plan.total, mime: 'image/jpeg', data: plan.chunks[idx],
            takenAt: m.takenAt, width: m.width, height: m.height, bytes: m.bytes, sha256: m.sha256, stampText: m.stampText
          };
          if (row.params.itemId) params.itemId = row.params.itemId;
          // サムネは index=0 のリクエストに同梱(単発は常に同梱)
          if (idx === 0) return KW.photo.blobToB64(pb.thumb).then(function (tb) { params.thumb = tb; return KW.api.call('uploadPhotoChunk', params, { timeoutMs: 60000 }); });
          return KW.api.call('uploadPhotoChunk', params, { timeoutMs: 60000 });
        });
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
    // 保存された詳細(キャッシュ)に当該 photoId が載っているときだけ「反映済み」とみなす
    return KW.data.loadDetail(rid).then(function () { return KW.data.getRow(rid); }, function () { return null; })
      .then(function (r) { fresh = !!(r && r.detail && KW.data.detailHasPhoto(r.detail, pid)); }, function () { fresh = false; })
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

  /* 30日超の行を期限切れ(failed)にする。変更があれば全行を読み直して返す */
  function expireRows() {
    return KW.outbox.all().then(function (rows) {
      var now = Date.now();
      var expired = rows.filter(function (r) { return (r.status === 'pending' || r.status === 'blocked') && KW.outbox.isExpired(r, now); });
      return Promise.all(expired.map(function (r) {
        return KW.outbox.update(r.seq, function (x) { x.status = 'failed'; x.blockReason = null; x.lastError = { code: 'EXPIRED', message: 'expired' }; });
      })).then(function () { return expired.length ? KW.outbox.all() : rows; });
    });
  }

  /* 1回のスケジュール: 送信可否規則で選んだ行を sending にし、それぞれ並行して送り始める(待たない) */
  function schedulePass() {
    if (!canSend()) return Promise.resolve();
    return expireRows().then(function (rows) {
      scheduleNext(rows);
      var P = KW.state.bootstrap && KW.state.bootstrap.config && KW.state.bootstrap.config.photoParallel;
      // 選択と pending→sending は同じトランザクション。送るのは読み直した最新の行(H1)
      return KW.outbox.claimSendable({ now: Date.now(), photoParallel: P }).then(function (claimed) {
        claimed.forEach(launch);
        return claimed.length ? refreshCounts() : null; // 送信中の写真の削除ボタン無効化などを反映
      });
    });
  }

  /* 送信を始める。終わったら空いたスロットを埋めるために再スケジュール */
  function launch(row) {
    inflight++;
    var p;
    try { p = send(row); } catch (e) { p = Promise.reject(e); }
    p.catch(function (e) {
      KW.reportError(e);
      // 想定外の例外: 行を送信待ちに戻す(入力を失わない)
      return KW.outbox.update(row.seq, function (x) { if (x.status === 'sending') x.status = 'pending'; }).catch(function () { return null; });
    }).then(function () {
      inflight--;
      return refreshCounts();
    }).then(function () { pump(); }, function () { pump(); });
  }

  function send(row) {
    var isPhoto = row.action === 'uploadPhotoChunk';
    var p = isPhoto ? sendPhotoChunk(row) : KW.api.call(row.action, row.params, { clientId: row.clientId });
    return p.then(function (res) { return handle(row, res, isPhoto); });
  }

  /* 送信中だった行が他の処理で保留(blocked)にされていたら、status は戻さない */
  function backToPending(x) { if (x.status === 'sending') x.status = 'pending'; }

  function handle(row, res, isPhoto) {
    if (res.ok) {
      if (isPhoto && !res.data.complete) {
        return KW.outbox.update(row.seq, function (x) { backToPending(x); x.photo.nextIndex = (x.photo.nextIndex || 0) + 1; x.tries = 0; }).then(function () { return true; });
      }
      var pid = isPhoto ? row.photo.photoId : null;
      return afterSuccess(row, res).then(function () {
        return pid ? finishPhoto(row, pid) : KW.outbox.remove(row.seq);
      }).then(function () { setOnline(true); return true; });
    }
    // 失敗
    var code = res.error && res.error.code;
    var kind = res.network ? 'retry' : KW.outbox.classify(code);
    if (kind === 'retry') {
      return KW.outbox.update(row.seq, function (x) {
        backToPending(x); x.tries = (x.tries || 0) + 1;
        x.nextTryAt = Date.now() + KW.outbox.backoffSec(x.tries) * 1000;
        x.lastError = { code: code || 'NETWORK', message: res.error && res.error.message };
      }).then(function () {
        // 連続3回の通信失敗(並行する全要求を通算。api.js が応答のたびに0へ戻す)でオフライン表示
        if (res.network && KW.state.netFails >= 3) setOnline(false);
        return !res.network;
      });
    }
    if (kind === 'chunk') {
      return KW.outbox.update(row.seq, function (x) { backToPending(x); x.photo.nextIndex = 0; x.nextTryAt = 0; }).then(function () { return true; });
    }
    if (kind === 'auth' || kind === 'locked' || kind === 'disabled' || kind === 'outdated') {
      // 行は保持。全行を保留にし、認証等が復帰したら再開(global handlerが画面遷移)
      var reason = kind === 'locked' ? 'locked' : (kind === 'outdated' ? 'outdated' : 'auth');
      return KW.outbox.update(row.seq, function (x) { x.status = 'pending'; x.lastError = { code: code }; })
        .then(function () { return KW.outbox.blockAll(reason); })
        .then(function () { return false; });
    }
    // 確定エラー(写真の行なら他の写真の行は止めず、同じ記録の後続の非写真の行だけ保留。SPEC §8.4)
    return KW.outbox.update(row.seq, function (x) {
      x.status = 'failed';
      x.lastError = { code: code, message: res.error && res.error.message, data: res.error && res.error.data };
    }).then(function () {
      return row.recordId ? KW.outbox.blockRecord(row.recordId, row.seq, isPhoto) : null;
    }).then(function () {
      KW.bus.emit('outbox:failed', row.recordId, code);
      return true;
    });
  }

  /* スケジューラの起動。同時に1本だけ動き、動いている間の呼び出しは「もう1回」に畳む */
  function pump() {
    if (recovering) return; // 起動時の recoverSending が済むまで送信を始めない(完了後に pump する)
    if (scheduling) { again = true; return; }
    scheduling = true;
    again = false;
    schedulePass().catch(function (e) { KW.reportError(e); }).then(function () {
      scheduling = false;
      if (again) { pump(); return null; }
      if (inflight === 0) return settle();
      return null;
    });
  }

  /* 送るものも送信中の要求も無くなった: 件数を更新し、待っている人を起こす */
  function settle() {
    return refreshCounts().then(function (rows) {
      scheduleNext(rows);
      if (scheduling || again || inflight > 0) return null;
      var w = idleWaiters; idleWaiters = [];
      w.forEach(function (f) { f(); });
      return null;
    });
  }
  function flushPromise() { return new Promise(function (r) { idleWaiters.push(r); }); }
  function kick() { var p = flushPromise(); pump(); return p; }

  /* 送信を走らせ、終わるまで待つ */
  function flush() {
    if (!canSend()) return refreshCounts().then(function () { return null; });
    return kick();
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
    // recoverSending を最初の kick より前に終える。完了までは online イベント等の kick も保留(pump が見送る)
    recovering = true;
    KW.outbox.recoverSending().then(function () { return KW.outbox.unblock(['outdated']); }).then(refreshCounts)
      .catch(function (e) { KW.reportError(e); })
      .then(function () { recovering = false; kick(); });
    window.addEventListener('online', function () { setOnline(true); KW.state.netFails = 0; kick(); pollOnce(); });
    window.addEventListener('offline', function () { setOnline(false); });
    // 通信失敗で「圏外」になった後も、ブラウザが online イベントを出さない場合がある。15秒ごとと画面復帰時に疎通を確かめて自動復帰する
    function probe() {
      if (KW.state.online || navigator.onLine === false || document.visibilityState === 'hidden') return;
      KW.api.call('ping', {}, { timeoutMs: 10000 }).then(function (res) {
        if (res.ok) { setOnline(true); KW.state.netFails = 0; kick(); pollOnce(); }
      });
    }
    setInterval(probe, 15000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') probe(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { kick(); pollOnce(); bootstrap(false); }
    });
    setInterval(kick, 30000);
    schedulePoll();
    KW.bus.on('bootstrap:changed', schedulePoll);
    KW.bus.on('outbox:changed', function () { refreshCounts(); pump(); });
  }

  KW.sync = { runQueued: runQueued, kick: kick, flush: flush, refreshCounts: refreshCounts, resumeAfterAuth: resumeAfterAuth, bootstrap: bootstrap, pollOnce: pollOnce, start: start, setOnline: setOnline, canSend: canSend };
})(window);
