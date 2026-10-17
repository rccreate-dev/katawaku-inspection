/* ui/components.js: 共通部品(チップ・バナー・写真ストリップなど) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, ts = KW.ts;
  var C = KW.ui = KW.ui || {};

  /* Blob URL 管理(画面遷移時に解放) */
  var urls = [];
  C.blobUrl = function (blob) { var u = URL.createObjectURL(blob); urls.push(u); return u; };
  C.releaseUrls = function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* 無視 */ } }); urls = []; };

  /* stage を渡すと approved の表示名が段階で変わる(打設前=打設可 / 出来形=出来形確認済。SPEC §6.8・§9.4) */
  C.statusChip = function (st, big, stage) { return h('span', { class: 'chip st-' + st + (big ? ' lg' : '') }, ts('st.' + st, stage)); };
  C.resultChip = function (r) { return r ? h('span', { class: 'chip ' + r }, t('result.' + r)) : h('span', { class: 'chip na' }, t('result.none')); };
  C.chip = function (kind, text) { return h('span', { class: 'chip ' + (kind || '') }, text); };

  C.banner = function (kind, children) { return h('div', { class: 'banner ' + (kind || ''), role: kind === 'bad' ? 'alert' : null }, children); };
  /* 実測入力: スマホの小数キーボードには「−」が無いため、符号切替ボタンを併設する(P-36)。
     値は半角/全角マイナスを許容して Number に直す。空・不正は null。 */
  C.signToggle = function (inp, disabled) {
    var b = h('button', { type: 'button', class: 'btn small ghost sign', 'aria-label': t('lbl.sign_toggle'), disabled: !!disabled }, '＋/－');
    b.addEventListener('click', function () {
      var v = String(inp.value || '').trim();
      inp.value = (v.charAt(0) === '-') ? v.slice(1) : '-' + v;
      inp.focus();
    });
    return b;
  };
  C.parseMeasure = function (raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/[−－ー‐]/g, '-').replace(/[＋]/g, '+').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (s === '' || s === '-' || s === '+') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  };
  C.msg = function (kind, text) { return h('div', { class: 'msg ' + (kind || '') }, text); };
  C.skeleton = function (n) { var f = document.createDocumentFragment(); for (var i = 0; i < (n || 3); i++) f.appendChild(h('div', { class: 'skel' })); return f; };

  C.toast = function (text, kind) {
    var box = document.getElementById('toasts');
    var el = h('div', { class: 'toast ' + (kind || '') }, text);
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
  };

  /* ---- 待つ操作の進行中表示(SPEC §8.11.8)---- */
  C.spinner = function () { return h('span', { class: 'spin', 'aria-hidden': 'true' }); };
  /* ボタンのラベルを『送信中…』+スピナーに差し替える / 元に戻す */
  C.setBusy = function (btn, on) {
    if (on) {
      if (btn._kwBusy) return;
      btn._kwBusy = Array.prototype.slice.call(btn.childNodes);
      btn.setAttribute('aria-busy', 'true');
      KW.clear(btn);
      btn.appendChild(C.spinner());
      btn.appendChild(document.createTextNode(t('act.sending')));
    } else {
      if (!btn._kwBusy) return;
      var kids = btn._kwBusy;
      btn._kwBusy = null;
      btn.removeAttribute('aria-busy');
      KW.clear(btn);
      kids.forEach(function (k) { btn.appendChild(k); });
    }
  };
  /* 応答が8秒を超えたら、anchor の下に『通信に時間がかかっています』を出す。戻り値の関数で止める */
  C.SLOW_MS = 8000;
  C.slowNote = function (anchor) {
    var note = null;
    var timer = setTimeout(function () {
      if (!anchor.isConnected || !anchor.parentNode) return;
      note = h('div', { class: 'msg warn slow', role: 'status' }, t('msg.slow_wait'));
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
    }, C.SLOW_MS);
    return function () { clearTimeout(timer); if (note && note.parentNode) note.parentNode.removeChild(note); note = null; };
  };

  /* 確認ダイアログのあとで API を呼ぶ操作用: 待っている間だけ btn を『送信中…』にする(C.guard は quiet で使う) */
  C.busyWhile = function (btn, promise) {
    C.setBusy(btn, true);
    var stop = C.slowNote(btn);
    var fin = function () { stop(); C.setBusy(btn, false); };
    return Promise.resolve(promise).then(function (r) { fin(); return r; }, function (e) { fin(); throw e; });
  };

  /* ボタンの二重押下防止+進行中表示。fn は Promise を返すこと。
   * 待つ操作(B)の標準動作: 押した直後に無効化+『送信中…』+スピナー、8秒超で案内文(SPEC §8.11.8)。
   * 端末内だけで終わる操作・別のモーダルを開くだけの操作は opts.quiet=true で無効化のみにする */
  C.guard = function (btn, fn, opts) {
    var quiet = !!(opts && opts.quiet);
    return function (ev) {
      if (btn.disabled) return;
      btn.disabled = true;
      var stop = null;
      if (!quiet) { C.setBusy(btn, true); stop = C.slowNote(btn); }
      var done = function () {
        if (stop) stop();
        if (!quiet) C.setBusy(btn, false);
        if (btn.isConnected) btn.disabled = false;
      };
      var p;
      try { p = fn(ev); } catch (e) { done(); KW.reportError(e); return; }
      Promise.resolve(p).then(done, function (e) { done(); KW.reportError(e); });
    };
  };

  /* 経過表示(skew補正) */
  C.ago = function (v) {
    var ms = KW.time.parse(v); if (ms == null) return '';
    var p = KW.time.agoParts(ms, KW.time.nowMs(KW.state.skewMs));
    return t(p.unit === 'min' ? 'time.min_ago' : 'time.hour_ago', { n: p.n });
  };
  C.fmt = function (v) { return KW.time.fmt(v); };

  /* 3値セグメント。items: [{v, label, cls}] */
  C.seg = function (items, current, onPick, opts) {
    opts = opts || {};
    var box = h('div', { class: 'seg' + (items.length === 2 ? ' two' : ''), role: 'group' });
    items.forEach(function (it) {
      var b = h('button', {
        type: 'button', class: 'v-' + it.v, 'aria-pressed': String(current === it.v), disabled: opts.disabled,
        on: { click: function () { onPick(current === it.v && opts.toggle ? null : it.v); } }
      }, it.label);
      box.appendChild(b);
    });
    return box;
  };

  /* 現場名・階などの表示(記録ヘッダ) */
  C.siteOf = function (siteId) {
    var b = KW.state.bootstrap;
    return b ? (b.sites || []).filter(function (s) { return s.siteId === siteId; })[0] || null : null;
  };
  /* 現場名。分からないときは siteId を出さず「現場不明」(SPEC §9.1) */
  C.siteName = function (siteId) { var s = C.siteOf(siteId); return s && s.name ? s.name : t('app.site_unknown'); };
  /* 記録IDから現場名を引く(キャッシュの records→bootstrap)。読み込み中・エラー時のヘッダ用。Promise<string> */
  C.siteNameOfRecord = function (recordId) {
    return KW.data.getRow(recordId).then(function (r) { return r && r.siteId ? C.siteName(r.siteId) : t('app.site_unknown'); }, function () { return t('app.site_unknown'); });
  };
  C.placeLine = function (rec) {
    return C.siteName(rec.siteId) + ' ' + rec.floor + (rec.zone ? '・' + rec.zone : '') + ' ・ ' + rec.lot;
  };
  /** 職長名(会社名)。会社名が空なら氏名のみ */
  C.ownerLabel = function (r) { return (r.ownerName || '') + (r.ownerCompany ? '(' + r.ownerCompany + ')' : ''); };

  C.recHeadCard = function (rec, extra) {
    return h('div', { class: 'rechead' },
      h('div', { class: 'big' }, C.siteName(rec.siteId)),
      h('div', { class: 'meta' }, [t('lbl.floor') + ': ' + rec.floor, rec.zone ? t('lbl.zone') + ': ' + rec.zone : null, t('lbl.lot') + ': ' + rec.lot, t('stage.' + (rec.stage || 'pre_pour'))].filter(Boolean).join(' / ')),
      extra || null);
  };

  /* 他班(masked)の記録行で stopPour だけ出す行。内容は出さず 現場・階・ロット・班名・ステータスのみ(SPEC §9.2 S04/S11)。
   * 行全体は開けない(ボタンではなく div)。「打設を止める」→ M4 */
  C.maskedStopRow = function (r) {
    var stopBtn = h('button', { type: 'button', class: 'btn small badghost' }, t('act.stop'));
    stopBtn.addEventListener('click', C.guard(stopBtn, function () {
      return KW.modal.stopPour(r).then(function (res) { if (res && res.ok) { if (!res.queued) C.toast(t('msg.stopped')); KW.bus.emit('records:refresh', r.recordId); } });
    }, { quiet: true }));
    var line = [C.siteName(r.siteId), r.floor, r.zone || null, t('lbl.lot') + ' ' + (r.lot || ''), r.team || null].filter(Boolean).join(' / ');
    return h('div', { class: 'tap masked' },
      h('span', null, h('b', null, t('badge.masked')), h('small', null, line)),
      h('span', { class: 'chips' }, C.statusChip(r.status, false, r.stage), stopBtn));
  };

  /* 送信状況が変わったとき、画面を作り直さずに削除ボタンの有効/無効だけ更新する */
  C.syncDeleteButtons = function (root) {
    var sp = KW.state.sendingPhotos || {};
    Array.prototype.forEach.call((root || document).querySelectorAll('button.x[data-pid]'), function (b) {
      var w = b.closest('.thumbwrap');
      if (w && w.getAttribute('data-mem') === 'saving') { b.disabled = true; return; }
      b.disabled = !!sp[b.getAttribute('data-pid')] && !!(w && w.querySelector('.up'));
    });
  };

  /* ---- 写真ごとの送信状態(SPEC §8.11.5)---- */
  var recentSaved = C.recentSaved = {}; // photoId -> 完了した時刻。『保存済み ✓』を約2秒だけ出す
  var SAVED_MS = 2000;

  function photoLabel(wrap) {
    var pid = wrap.getAttribute('data-pid');
    var mem = wrap.getAttribute('data-mem');
    var recent = recentSaved[pid] && (Date.now() - recentSaved[pid]) < SAVED_MS;
    if (mem === 'failed') return { st: 'failed', text: t('photo.st.failed'), note: t('photo.save_failed'), icon: 'warn' };
    if (mem === 'saving') return { st: 'queued', text: t('photo.st.queued'), note: null, icon: null };
    if (wrap.hasAttribute('data-local')) {
      var row = (KW.state.photoRows || {})[pid] || null;
      if (row) {
        var st = KW.outbox.photoState(row);
        if (st === 'sending') return { st: 'sending', text: t('photo.st.sending'), note: null, icon: 'spin' };
        if (st === 'failed') return { st: 'failed', text: t('photo.st.failed'), note: null, icon: 'warn' };
        var retry = (row.tries || 0) >= 1;
        var notes = [];
        if (retry) notes.push(t('photo.st.retry', { n: row.tries }));
        if (!KW.isOnline()) notes.push(t('photo.st.offline'));
        return { st: 'queued', text: t('photo.st.queued'), note: notes.join(' / ') || null, icon: retry ? 'warn' : null };
      }
    }
    // サーバーに載った(行が無い)。直後の約2秒だけ緑で見せ、以後は何も付けない
    if (recent) return { st: 'saved', text: t('photo.st.saved'), note: null, icon: 'check' };
    return null;
  }
  /* サムネ1枚の状態ラベルを描き直す(data-pid / data-local / data-mem から決める) */
  function paintPhoto(wrap) {
    var thumb = wrap.querySelector('.thumb');
    if (!thumb) return;
    var old = thumb.querySelector('.up');
    if (old) old.parentNode.removeChild(old);
    var oldNote = wrap.querySelector('.pnote');
    if (oldNote) oldNote.parentNode.removeChild(oldNote);
    wrap.className = wrap.className.replace(/\bps-\w+\b/g, '').replace(/\s+/g, ' ').trim();
    var l = photoLabel(wrap);
    if (!l) return;
    wrap.className += ' ps-' + l.st;
    var up = h('span', { class: 'up' }, l.icon === 'spin' ? C.spinner() : (l.icon ? KW.icon(l.icon) : null), l.text);
    thumb.appendChild(up);
    if (l.note) thumb.parentNode.insertBefore(h('span', { class: 'pnote' }, l.note), thumb.nextSibling);
    thumb.setAttribute('aria-label', t('photo.view') + ' ' + l.text + (l.note ? ' ' + l.note : ''));
  }
  C.syncPhotoStates = function (root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.thumbwrap[data-pid]'), paintPhoto);
  };
  KW.bus.on('outbox:counts', function () { C.syncPhotoStates(document); });
  KW.bus.on('net:changed', function () { C.syncPhotoStates(document); });
  KW.bus.on('photo:done', function (rid, pid) {
    if (!pid) return;
    recentSaved[pid] = Date.now();
    setTimeout(function () { delete recentSaved[pid]; C.syncPhotoStates(document); }, SAVED_MS + 50);
  });

  /* 失敗している行の再送(S20の『再送』と同じ。期限切れは送らない。SPEC §8.5) */
  function rowExpired(r) { return (r.lastError && r.lastError.code === 'EXPIRED') || KW.outbox.isExpired(r, Date.now()); }
  C.rowExpired = rowExpired;
  C.resendRows = function (rows) {
    var rids = {};
    return Promise.all(rows.filter(function (r) { return !rowExpired(r); }).map(function (r) {
      if (r.recordId) rids[r.recordId] = 1;
      return KW.outbox.update(r.seq, function (x) { x.status = 'pending'; x.tries = 0; x.nextTryAt = 0; x.lastError = null; x.blockReason = null; });
    })).then(function () {
      return Promise.all(Object.keys(rids).map(function (rid) { return KW.outbox.unblockRecord(rid); }));
    }).then(function () { return KW.sync.flush(); });
  };

  /* 失敗した写真をタップしたとき: [再送][破棄=その写真を消す](SPEC §8.11.4) */
  function photoFailSheet(p, row) {
    return KW.modal.sheet(function (m) {
      var err = h('div');
      var rs = h('button', { type: 'button', class: 'btn' }, t('act.resend'));
      rs.addEventListener('click', C.guard(rs, function () {
        return C.resendRows([row]).then(function () { m.close(); KW.bus.emit('photo:done', row.recordId, null); });
      }));
      var ds = h('button', { type: 'button', class: 'btn badghost' }, t('act.discard'));
      ds.addEventListener('click', C.guard(ds, function () {
        return C.discardRow(row).then(function () { return KW.sync.refreshCounts(); }).then(function () {
          m.close(); KW.bus.emit('photo:done', row.recordId, null);
        });
      }, { quiet: true }));
      var expired = rowExpired(row);
      return [
        h('h2', null, t('photo.st.failed')),
        row.lastError ? C.msg('', expired ? t('outbox.expired') : KW.errText(row.lastError)) : null,
        err,
        h('div', { class: 'stack' },
          expired ? null : rs, ds,
          h('button', { type: 'button', class: 'btn ghost', on: { click: function () { m.close(); KW.modal.photoView(p); } } }, t('photo.view')),
          h('button', { type: 'button', class: 'btn ghost', on: { click: function () { m.close(); } } }, t('act.close')))
      ];
    });
  }

  /* 撮影直後のメモリ上のサムネ(SPEC §8.11.5)。端末への保存を待たずに出し、保存に失敗したら赤で知らせる */
  C.memPhotos = function () {
    var list = [];
    return {
      add: function (o) { list.push({ photoId: o.photoId, itemId: o.itemId || null, side: o.side, thumb: o.thumb, state: 'saving' }); },
      fail: function (pid) { list.forEach(function (x) { if (x.photoId === pid) x.state = 'failed'; }); },
      drop: function (pid) { list = list.filter(function (x) { return x.photoId !== pid; }); },
      has: function (pid) { return list.some(function (x) { return x.photoId === pid; }); },
      /* 項目(または図面 itemId=null)の分。端末に保存済み(blobs にある)ものは含めない */
      forItem: function (itemId, side, blobs) {
        var have = {};
        (blobs || []).forEach(function (b) { have[b.photoId] = 1; });
        return list.filter(function (x) { return x.itemId === (itemId || null) && x.side === side && !have[x.photoId]; })
          .map(function (x) { return { photoId: x.photoId, local: true, mem: x.state, blob: x.thumb, thumbBlob: x.thumb }; });
      }
    };
  };

  /* 写真ストリップ(サムネは getPhotoThumbs/キャッシュ。ローカル未送信はBlob)。
   * ローカルの写真には送信状態のラベルを常に付ける(SPEC §8.11.5)。ラベルの無い写真=サーバーに保存済み */
  C.photoStrip = function (photos, opts) {
    opts = opts || {};
    var box = h('div', { class: 'photos' });
    var imgs = {};
    photos.forEach(function (p) {
      var img = h('img', { alt: '' });
      imgs[p.photoId] = img;
      var btn = h('button', {
        type: 'button', class: 'thumb', 'aria-label': t('photo.view'),
        on: { click: function () {
          var row = p.local && !p.mem ? (KW.state.photoRows || {})[p.photoId] : null;
          if (row && KW.outbox.photoState(row) === 'failed') { photoFailSheet(p, row); return; }
          if (opts.onView) opts.onView(p); else KW.modal.photoView(p);
        } }
      }, img);
      var wrap = h('span', { class: 'thumbwrap', 'data-pid': p.photoId }, btn);
      if (p.local) wrap.setAttribute('data-local', '1');
      if (p.mem) wrap.setAttribute('data-mem', p.mem);
      if (opts.onDelete && p.canDelete !== false) {
        // 送信中(sending)の写真は削除ボタンを無効にする(送信完了後に削除でき、そのとき deletePhoto を積む。SPEC §8.3)
        wrap.appendChild(h('button', { type: 'button', class: 'x', 'data-pid': p.photoId, 'aria-label': t('act.delete'), disabled: !!(p.mem === 'saving' || (p.local && KW.state.sendingPhotos && KW.state.sendingPhotos[p.photoId])), on: { click: function () { opts.onDelete(p); } } }, '×'));
      }
      box.appendChild(wrap);
      if (p.local && p.blob) img.src = C.blobUrl(p.thumbBlob || p.blob);
      paintPhoto(wrap);
    });
    var need = photos.filter(function (p) { return !p.local; }).map(function (p) { return p.photoId; });
    if (need.length) {
      KW.data.loadThumbs(need).then(function (map) {
        Object.keys(map).forEach(function (id) { if (imgs[id] && imgs[id].isConnected !== false) imgs[id].src = C.blobUrl(map[id]); });
      }).catch(function (e) { KW.state.lastErr = String(e && e.message || e); /* サムネが出ないだけ。エラー表示は出さない */ });
    }
    return box;
  };

  /*
   * 記録の保存状態(S06/S08/S10 共通。SPEC §8.11.6)と、送信できなかった入力のバナー(§8.11.4)。
   * ヘッダ直下に置く。ctx は画面の ctx(画面を離れると更新を止める)。
   * o.beforeDiscard(): 入力の破棄の直前に呼ぶ(画面の作業コピーの保存を止める)。o.afterDiscard(): 破棄の後(既定は画面を作り直す)
   */
  C.recordStatus = function (ctx, recordId, o) {
    o = o || {};
    var box = h('div', { class: 'rstatus' });
    var INPUT = { saveDraft: 1, saveQaDraft: 1 };

    function draw(rows) {
      KW.clear(box);
      var st = KW.outbox.saveStateOf(rows, KW.isOnline());
      var line;
      if (st.kind === 'synced') line = h('div', { class: 'savestate ss-synced', role: 'status' }, KW.icon('check'), t('save.synced'));
      else if (st.kind === 'sending') line = h('div', { class: 'savestate ss-sending', role: 'status' }, C.spinner(), t('save.sending', { n: st.n }));
      else if (st.kind === 'queued') line = h('div', { class: 'savestate ss-queued', role: 'status' }, t('save.queued', { n: st.n }));
      else if (st.kind === 'offline') line = h('div', { class: 'savestate ss-offline', role: 'status' }, KW.icon('warn'), t('save.offline', { n: st.n }));
      else {
        line = h('div', { class: 'savestate ss-failed', role: 'status' }, KW.icon('warn'), h('span', null, t('save.failed', { m: st.m })),
          h('button', { type: 'button', class: 'btn small', on: { click: function () { KW.app.go('#/outbox'); } } }, t('save.check')));
      }
      box.appendChild(line);

      // 送信できなかった入力(saveDraft / saveQaDraft の確定失敗)。入力は端末の作業コピーに残っている
      var bad = rows.filter(function (r) { return INPUT[r.action] && r.status === 'failed'; });
      if (!bad.length) return;
      var locked = bad.some(function (r) { return r.lastError && (r.lastError.code === 'RECORD_LOCKED' || r.lastError.code === 'STATE_CONFLICT'); });
      var canResend = bad.some(function (r) { return !rowExpired(r); });
      var rs = h('button', { type: 'button', class: 'btn small' }, t('act.resend'));
      rs.addEventListener('click', C.guard(rs, function () { return C.resendRows(bad); }));
      var ds = h('button', { type: 'button', class: 'btn small badghost' }, t('act.discard'));
      ds.addEventListener('click', C.guard(ds, function () {
        return KW.modal.confirm({ title: t('act.discard'), body: t('outbox.discard_body'), okLabel: t('act.discard'), danger: true }).then(function (ok) {
          if (!ok) return null;
          if (o.beforeDiscard) o.beforeDiscard();
          return bad.reduce(function (p, r) { return p.then(function () { return C.discardRow(r); }); }, Promise.resolve())
            .then(function () { return KW.sync.refreshCounts(); })
            .then(function () { if (o.afterDiscard) o.afterDiscard(); else ctx.rerender(); });
        });
      }, { quiet: true }));
      box.appendChild(C.banner('bad', [
        h('b', null, t('outbox.problem_input')),
        locked ? h('div', { class: 'sub' }, t('outbox.locked_hint')) : null,
        h('div', { class: 'gap' },
          h('button', { type: 'button', class: 'btn small ghost', on: { click: function () { KW.app.go('#/outbox'); } } }, t('save.check')),
          canResend ? rs : null, ds)
      ]));
    }
    function refresh() { KW.outbox.forRecord(recordId).then(function (rows) { if (ctx.alive()) draw(rows); }); }
    ctx.on('outbox:counts', refresh);
    ctx.on('net:changed', refresh);
    refresh();
    return box;
  };

  /* 違反ruleの表示(項目の下) */
  C.ruleMsgs = function (rules) {
    var f = document.createDocumentFragment();
    (rules || []).forEach(function (r) { f.appendChild(C.msg('', t('rule.' + r))); });
    return f;
  };

  /* 画面上部の空状態 */
  C.empty = function (key) { return h('p', { class: 'sub' }, t(key)); };

  /* ステータス帯(停止・重大・エスカレーション) */
  C.flags = function (rec) {
    var f = [];
    if (rec.stopped) f.push(C.chip('bad', t('badge.stopped')));
    if (rec.major) f.push(C.chip('bad', t('badge.major')));
    if (rec.escLevel) f.push(C.chip('warn', t('esc.' + rec.escLevel)));
    return f;
  };

  C.roleName = function (r) { return t('role.' + r); };

  /* 数値配列の表示 */
  C.valuesText = function (v, unit) { return (v || []).map(function (x, i) { return KW.photo.pointNo(i + 1) + (x > 0 ? '+' : '') + x; }).join(', ') + (v && v.length ? ' ' + (unit || 'mm') : ''); };

  /* 現場の階順ソート用: floors の並びに従う */
  C.floorIndex = function (siteId, floor) {
    var s = C.siteOf(siteId);
    var i = s ? s.floors.indexOf(floor) : -1;
    return i < 0 ? 999 : i;
  };
})(window);
