/* ui/components.js: 共通部品(チップ・バナー・写真ストリップなど) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t;
  var C = KW.ui = KW.ui || {};

  /* Blob URL 管理(画面遷移時に解放) */
  var urls = [];
  C.blobUrl = function (blob) { var u = URL.createObjectURL(blob); urls.push(u); return u; };
  C.releaseUrls = function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* 無視 */ } }); urls = []; };

  C.statusChip = function (st, big) { return h('span', { class: 'chip st-' + st + (big ? ' lg' : '') }, t('st.' + st)); };
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

  /* ボタンの二重押下防止。fn は Promise を返すこと */
  C.guard = function (btn, fn) {
    return function (ev) {
      if (btn.disabled) return;
      btn.disabled = true;
      var done = function () { if (btn.isConnected) btn.disabled = false; };
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
    }));
    var line = [C.siteName(r.siteId), r.floor, r.zone || null, t('lbl.lot') + ' ' + (r.lot || ''), r.team || null].filter(Boolean).join(' / ');
    return h('div', { class: 'tap masked' },
      h('span', null, h('b', null, t('badge.masked')), h('small', null, line)),
      h('span', { class: 'chips' }, C.statusChip(r.status), stopBtn));
  };

  /* 写真ストリップ(サムネは getPhotoThumbs/キャッシュ。ローカル未送信はBlob) */
  C.photoStrip = function (photos, opts) {
    opts = opts || {};
    var box = h('div', { class: 'photos' });
    var imgs = {};
    photos.forEach(function (p) {
      var img = h('img', { alt: '' });
      imgs[p.photoId] = img;
      var btn = h('button', {
        type: 'button', class: 'thumb', 'aria-label': t('photo.view'),
        on: { click: function () { if (opts.onView) opts.onView(p); else KW.modal.photoView(p); } }
      }, img, p.local ? h('span', { class: 'up' }, t('photo.uploading')) : null);
      var wrap = h('span', { class: 'thumbwrap' }, btn);
      if (opts.onDelete && p.canDelete !== false) {
        wrap.appendChild(h('button', { type: 'button', class: 'x', 'aria-label': t('act.delete'), on: { click: function () { opts.onDelete(p); } } }, '×'));
      }
      box.appendChild(wrap);
      if (p.local && p.blob) img.src = C.blobUrl(p.thumbBlob || p.blob);
    });
    var need = photos.filter(function (p) { return !p.local; }).map(function (p) { return p.photoId; });
    if (need.length) {
      KW.data.loadThumbs(need).then(function (map) {
        Object.keys(map).forEach(function (id) { if (imgs[id] && imgs[id].isConnected !== false) imgs[id].src = C.blobUrl(map[id]); });
      });
    }
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
  C.valuesText = function (v, unit) { return (v || []).map(function (x) { return (x > 0 ? '+' : '') + x; }).join(', ') + (v && v.length ? ' ' + (unit || 'mm') : ''); };

  /* 現場の階順ソート用: floors の並びに従う */
  C.floorIndex = function (siteId, floor) {
    var s = C.siteOf(siteId);
    var i = s ? s.floors.indexOf(floor) : -1;
    return i < 0 ? 999 : i;
  };
})(window);
