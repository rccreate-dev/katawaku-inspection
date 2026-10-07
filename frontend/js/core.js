/* core.js: 名前空間・状態・イベントバス・t()・DOMヘルパ・ID生成 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var CFG = root.KW_CONFIG || {};
  KW.config = CFG;
  KW.screens = KW.screens || {};
  /* 画面間の受け渡し(読込順に依存しないよう core に置く): サーバー検証違反・提出後の警告 */
  KW.flash = KW.flash || { violations: {}, record: {} };

  KW.state = {
    me: null, device: null, bootstrap: null, lang: 'ja',
    online: (typeof navigator === 'undefined') ? true : navigator.onLine !== false,
    netFails: 0, skewMs: 0, outboxCount: 0, outboxBad: 0, lastSyncAt: null,
    token: null, updateReady: false, outdated: false, stopQueued: 0
  };

  /* ---- イベントバス ---- */
  var handlers = {};
  KW.bus = {
    on: function (ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
      return function () { KW.bus.off(ev, fn); };
    },
    off: function (ev, fn) {
      handlers[ev] = (handlers[ev] || []).filter(function (f) { return f !== fn; });
    },
    emit: function (ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      (handlers[ev] || []).slice().forEach(function (fn) {
        try { fn.apply(null, args); } catch (e) { KW.reportError(e); }
      });
    }
  };

  KW.reportError = function (e) {
    try { KW.bus.emit('app:error', e); } catch (x) { /* 無視 */ }
  };

  /* ---- i18n ---- */
  KW.t = function (key, params) {
    var dict = root.I18N || {};
    var cur = dict[KW.state.lang];
    var s = cur && cur[key] != null ? cur[key] : null;
    if (s == null && dict.ja && dict.ja[key] != null) s = dict.ja[key];
    if (s == null) return key;
    if (params) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
    }
    return s;
  };
  root.t = KW.t;

  KW.pickLang = function (lang) { return lang === 'id' ? 'id' : 'ja'; };

  /* ---- DOM ヘルパ(textContent のみ。生文字をinnerHTMLに入れない) ---- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function append(el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) { append(el, k); continue; }
      if (k.nodeType) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
  }
  KW.h = function (tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'disabled' || k === 'hidden' || k === 'required' || k === 'multiple' || k === 'readOnly') el[k] = !!v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    append(el, Array.prototype.slice.call(arguments, 2));
    return el;
  };
  KW.svg = function (paths, cls) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    paths.forEach(function (d) {
      var p;
      if (d.c) { p = document.createElementNS(SVGNS, 'circle'); p.setAttribute('cx', d.c[0]); p.setAttribute('cy', d.c[1]); p.setAttribute('r', d.c[2]); }
      else { p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); }
      s.appendChild(p);
    });
    return s;
  };
  KW.icon = function (name) {
    var map = {
      camera: ['M4 8h3l2-3h6l2 3h3v11H4z', { c: [12, 13, 3.5] }],
      close: ['M6 6l12 12M18 6L6 18'],
      back: ['M15 5l-7 7 7 7'],
      refresh: ['M20 11a8 8 0 10-2.3 5.7', 'M20 4v7h-7']
    };
    return KW.svg(map[name] || [], 'ico');
  };
  KW.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* ---- ID 生成 ---- */
  function randStr(n, alphabet) {
    var out = '', buf = new Uint8Array(n);
    (root.crypto || root.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) out += alphabet.charAt(buf[i] % alphabet.length);
    return out;
  }
  var LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var MIXED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  KW.newRecordId = function () { return 'r_' + randStr(16, LOWER); };
  KW.newPhotoId = function () { return 'p_' + randStr(16, LOWER); };
  KW.newClientId = function () { return 'c_' + randStr(24, MIXED); };

  /* ---- 汎用 ---- */
  KW.debounce = function (fn, ms) {
    var timer = null;
    var d = function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(null, args); }, ms);
    };
    d.flush = function () { if (timer) { clearTimeout(timer); timer = null; fn(); } };
    return d;
  };
  KW.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  KW.isOnline = function () { return KW.state.online && navigator.onLine !== false; };
  KW.langName = function (lang) { return KW.t('lang.name.' + lang); };

  /* 項目マスタの表示テキスト(辞書ではなくマスタ列) */
  KW.itemText = function (def) { return KW.state.lang === 'id' ? def.textId : def.textJa; };
  KW.groupText = function (def) { return KW.state.lang === 'id' ? def.groupId : def.groupJa; };

  /* エラー表示文言 */
  KW.errText = function (err) {
    if (!err) return KW.t('err.INTERNAL');
    var code = err.code || 'INTERNAL';
    if (code === 'NETWORK') return KW.t('err.network');
    var key = 'err.' + code;
    var s = (root.I18N && root.I18N.ja && root.I18N.ja[key] != null) ? KW.t(key) : KW.t('err.INTERNAL');
    var d = err.data || {};
    if ((code === 'PIN_INVALID' || code === 'INVITE_INVALID') && d.remaining != null) {
      s += ' ' + KW.t('msg.pin_remaining', { n: d.remaining });
    }
    if (code === 'ALREADY_CLAIMED' && d.claimedByName) s = KW.t('msg.claimed_by_name', { name: d.claimedByName });
    if (code === 'NOT_CLAIMER' && d.claimedByName) s = KW.t('msg.claimed_by_name', { name: d.claimedByName });
    return s;
  };
})(window);
