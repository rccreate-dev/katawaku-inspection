/* app.js: 起動(S00)・ルータ・ヘッダ/タブ・グローバルエラー処理 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var S = KW.state;
  var app = KW.app = {};

  var $ = function (id) { return document.getElementById(id); };
  var chrome = { tab: null, back: null, site: null, bar: null };
  var current = null; // { cleanups:[], route }
  var started = false;
  var badge = { board: 0 };

  /* ---- ルート表 ---- */
  var ROUTES = [
    [/^\/$/, 'home'],
    [/^\/register$/, 'S01'],
    [/^\/locked$/, 'S02'],
    [/^\/site\/([^/]+)$/, 'S04'],
    [/^\/site\/([^/]+)\/new$/, 'S05'],
    [/^\/record\/([^/]+)\/edit$/, 'S06'],
    [/^\/record\/([^/]+)\/confirm$/, 'S07'],
    [/^\/record\/([^/]+)\/review$/, 'S10'],
    [/^\/record\/([^/]+)$/, 'S08'],
    [/^\/history$/, 'S11'],
    [/^\/roster$/, 'S12'],
    [/^\/join$/, 'S13'],
    [/^\/joins$/, 'S14'],
    [/^\/admin$/, 'ADMIN'],
    [/^\/admin\/users$/, 'S16'],
    [/^\/admin\/absences$/, 'S17'],
    [/^\/admin\/qr$/, 'S18'],
    [/^\/settings$/, 'S19'],
    [/^\/outbox$/, 'S20']
  ];
  var PUBLIC_PATHS = { '/register': 1, '/locked': 1 };

  function parseQuery(q) {
    var o = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { o[k] = v; }
    });
    return o;
  }
  function parseHash() {
    var s = (location.hash || '#/').replace(/^#/, '');
    var q = '', i = s.indexOf('?');
    if (i >= 0) { q = s.slice(i + 1); s = s.slice(0, i); }
    if (!s) s = '/';
    return { path: s, query: parseQuery(q) };
  }

  app.go = function (hash, replace) {
    if (replace) { history.replaceState(null, '', hash); route(); return; }
    if (location.hash === hash) route(); else location.hash = hash;
  };
  app.rerender = function () { KW.bus.emit('app:beforeRerender'); renderChrome(); route(true); };

  /* ---- ヘッダ ---- */
  function renderHeader() {
    var top = KW.clear($('top'));
    var net = h('span', { class: 'net' + (KW.isOnline() ? '' : ' off'), role: 'status' }, h('i'), KW.isOnline() ? t('app.online') : t('app.offline'));
    var cnt = S.outboxCount;
    var obx = h('button', { type: 'button', class: 'obx' + (S.outboxBad ? ' bad' : ''), 'aria-label': t('outbox.title'), on: { click: function () { app.go('#/outbox'); } } },
      t('outbox.badge', { n: cnt }));
    if (!S.token) obx.hidden = true;
    var lang = h('button', { type: 'button', class: 'lang', 'aria-label': t('lang.label'), on: { click: function () { app.setLang(S.lang === 'ja' ? 'id' : 'ja'); } } }, t('lang.switch'));
    top.appendChild(h('div', { class: 'bar1' },
      h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }), h('span', { class: 'name' }, t('app.name'))),
      h('div', { class: 'ctl' }, net, obx, lang)));
    if (chrome.back || chrome.site || chrome.bar) {
      var row = h('div', { class: 'sitebar' });
      if (chrome.back) row.appendChild(h('button', { type: 'button', class: 'link back', on: { click: function () { app.go(chrome.back); } } }, KW.icon('back'), t('nav.back')));
      if (chrome.site) row.appendChild(h('b', null, chrome.site));
      if (chrome.bar) row.appendChild(h('span', null, chrome.bar));
      top.appendChild(row);
    }
  }
  function renderTabs() {
    var bar = $('tabbar');
    KW.clear(bar);
    var role = S.me && S.me.role;
    var show = !!(role && S.token && chrome.tab);
    document.body.classList.toggle('has-tabs', show);
    bar.hidden = !show;
    if (!show) return;
    var list = role === 'foreman'
      ? [['home', '#/', 'nav.home'], ['history', '#/history', 'nav.history'], ['settings', '#/settings', 'nav.settings']]
      : [['home', '#/', 'nav.board'], ['history', '#/history', 'nav.history'], ['roster', '#/roster', 'nav.roster']]
        .concat(role === 'lead' ? [['admin', '#/admin', 'nav.admin']] : [])
        .concat([['settings', '#/settings', 'nav.settings']]);
    var inner = h('div', { class: 'in' });
    list.forEach(function (x) {
      var b = h('button', { type: 'button', 'aria-current': chrome.tab === x[0] ? 'page' : null, on: { click: function () { app.go(x[1]); } } }, t(x[2]));
      if (x[0] === 'home' && role !== 'foreman' && badge.board > 0) b.appendChild(h('span', { class: 'badge' }, String(badge.board)));
      inner.appendChild(b);
    });
    bar.appendChild(inner);
  }
  function renderChrome() { renderHeader(); renderTabs(); document.title = t('app.name'); document.documentElement.lang = S.lang; }
  app.renderChrome = renderChrome;

  /* ---- バナー(更新・古いバージョン) ---- */
  function renderBanners() {
    var box = KW.clear($('banners'));
    if (S.updateReady) {
      box.appendChild(C.banner('', h('div', { class: 'row' }, h('b', null, t('msg.update_available')),
        h('button', { type: 'button', class: 'btn small', on: { click: applyUpdate } }, t('act.update')))));
    }
    // アプリが古い(CLIENT_OUTDATED): 送信は止まっている。「更新」で SW の更新確認→skipWaiting→リロード(SPEC §8.10)
    if (S.outdated) {
      var upd = h('button', { type: 'button', class: 'btn small', on: { click: applyUpdate } }, t('act.update'));
      box.appendChild(C.banner('bad', h('div', { class: 'row' }, h('b', null, t('err.CLIENT_OUTDATED')), upd)));
    }
    // 打設停止が送信待ちのまま(圏外など): 送信されるまで消さない強調バナー(SPEC §8.1)
    if (S.stopQueued > 0) box.appendChild(C.banner('bad', h('b', { class: 'urgent' }, t('msg.stop_queued_call'))));
  }
  var swReg = null, wantReload = false;
  function postSkip(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
  function applyUpdate() {
    wantReload = true;
    if (swReg && swReg.waiting) { postSkip(swReg.waiting); return; }
    if (!swReg) { location.reload(); return; }
    // 待機中のSWが無い: 更新確認 → 見つかれば installed を待って skipWaiting、無ければリロード
    C.toast(t('msg.updating'));
    swReg.update().then(function () {
      if (swReg.waiting) { postSkip(swReg.waiting); return; }
      var nw = swReg.installing;
      if (!nw) { location.reload(); return; }
      nw.addEventListener('statechange', function () {
        if (nw.state === 'installed' && swReg.waiting) postSkip(swReg.waiting);
        else if (nw.state === 'redundant') location.reload();
      });
    }, function () { location.reload(); });
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      // 起動時に更新確認(古い版のまま使い続けないため)
      try { reg.update().catch(function () { /* 圏外などは無視 */ }); } catch (e) { /* 無視 */ }
      var ready = function () { S.updateReady = true; renderBanners(); };
      if (reg.waiting && navigator.serviceWorker.controller) ready();
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) ready(); });
      });
    }, function () { /* SW非対応環境では無視 */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (wantReload) location.reload(); });
  }

  /* ---- ルーティング ---- */
  function runCleanups() {
    if (!current) return;
    current.cleanups.forEach(function (f) { try { f(); } catch (e) { /* 無視 */ } });
    current = null;
    C.releaseUrls();
  }
  function route(keepScroll) {
    runCleanups();
    var loc = parseHash();
    var path = loc.path;
    if (!S.token && !PUBLIC_PATHS[path]) {
      if (path === '/join' && loc.query.site) KW.db.kvSet('pendingJoin', { site: loc.query.site, k: loc.query.k || '', n: loc.query.n || '' });
      app.go('#/register', true);
      return;
    }
    if (S.token && S.me && S.me.status === 'locked' && path !== '/locked') { app.go('#/locked', true); return; }
    var name = null, params = [];
    for (var i = 0; i < ROUTES.length; i++) {
      var m = ROUTES[i][0].exec(path);
      if (m) { name = ROUTES[i][1]; params = m.slice(1).map(decodeURIComponent); break; }
    }
    if (name === 'home') name = (S.me && S.me.role === 'foreman') ? 'S03' : 'S09';
    if (!name) { app.go('#/', true); return; }
    chrome = { tab: null, back: null, site: null, bar: null };
    var view = KW.clear($('view'));
    var cur = current = { cleanups: [], route: path };
    var ctx = {
      params: params, query: loc.query, el: view, path: path,
      chrome: function (c) { chrome = Object.assign({ tab: null, back: null, site: null, bar: null }, c); if (current === cur) renderChrome(); },
      on: function (ev, fn) { var off = KW.bus.on(ev, function () { if (current === cur) fn.apply(null, arguments); }); cur.cleanups.push(off); },
      cleanup: function (fn) { cur.cleanups.push(fn); },
      alive: function () { return current === cur; },
      rerender: function () { route(true); }
    };
    renderChrome();
    if (!keepScroll) window.scrollTo(0, 0);
    var scr = KW.screens[name];
    if (!scr) { view.appendChild(h('p', null, name)); return; }
    try {
      var r = scr.mount(ctx);
      if (r && r.catch) r.catch(function (e) { KW.reportError(e); });
    } catch (e) { KW.reportError(e); }
  }
  app.route = route;

  /* ---- 言語 ---- */
  app.setLang = function (lang) {
    lang = KW.pickLang(lang);
    KW.bus.emit('app:beforeRerender');
    S.lang = lang;
    KW.db.kvSet('lang', lang);
    renderChrome(); renderBanners();
    route(true);
    if (S.token && KW.isOnline()) KW.api.call('setLang', { lang: lang }, { silentAuth: true });
  };

  /* ---- セッション ---- */
  function clearToken() {
    S.token = null; S.device = null;
    return Promise.all([KW.db.kvDel('deviceToken'), KW.db.kvDel('deviceId')]);
  }
  app.clearToken = clearToken;

  /* ログアウト等で端末データを全消去 */
  app.wipeAll = function () {
    S.token = null; S.me = null; S.bootstrap = null; S.outboxCount = 0; S.outboxBad = 0;
    return KW.db.clearAll();
  };

  /* 端末のユーザー切替時の消去(SPEC §8.2)。records/bootstrap/photoCache は outbox の有無によらず必ず消す。
   * discard=true(破棄して切替)は outbox・drafts・photoBlobs を含む全ストアを消す。
   * discard でないとき outbox は既に空(無し、または送信済み)なので drafts・photoBlobs も消す */
  function wipeForSwitch(discard) {
    S.bootstrap = null; S.lastSyncAt = null; S.joinPending = 0;
    if (discard) {
      return Promise.all([KW.db.kvGet('pendingJoin'), KW.db.kvGet('skewMs')]).then(function (v) {
        return KW.db.clearAll().then(function () {
          // 新ユーザーの参加QR保留と時刻補正は引き継ぐ
          return Promise.all([v[0] ? KW.db.kvSet('pendingJoin', v[0]) : null, typeof v[1] === 'number' ? KW.db.kvSet('skewMs', v[1]) : null]);
        });
      });
    }
    return Promise.all(['records', 'photoCache', 'drafts', 'photoBlobs'].map(function (n) { return KW.db.clear(n); }))
      .then(function () { return Promise.all(['bootstrap', 'recordsSince', 'lastSyncAt'].map(function (k) { return KW.db.kvDel(k); })); });
  }

  /* 登録成功後。opts.discard: 「破棄して切替」を選んだ(消去は registerDevice 成功後のここで行う) */
  app.afterRegister = function (data, opts) {
    opts = opts || {};
    var prevUser = null;
    return KW.db.kvGet('lastUserId').then(function (u) {
      prevUser = u;
      var switched = !!(u && u !== data.user.userId);
      // 先に消去し、その後に新ユーザーの token を保存して送信を再開する(旧ユーザーの行を新 token で送らない)
      return switched ? wipeForSwitch(!!opts.discard) : null;
    }).then(function () {
      S.token = data.deviceToken; S.me = data.user;
      return Promise.all([
        KW.db.kvSet('deviceToken', data.deviceToken), KW.db.kvSet('deviceId', data.deviceId),
        KW.db.kvSet('me', data.user), KW.db.kvSet('lastUserId', data.user.userId)
      ]);
    }).then(function () {
      S.lang = KW.pickLang(data.user.lang);
      return KW.db.kvSet('lang', S.lang);
    }).then(function () {
      return KW.sync.resumeAfterAuth(prevUser === S.me.userId);
    }).then(function () { return app.startSession(); });
  };

  app.startSession = function () {
    renderChrome();
    if (S.me && S.me.status === 'locked') { app.go('#/locked', true); return Promise.resolve(); }
    return KW.sync.bootstrap(true).then(function () {
      KW.data.syncRecords(true).then(function () { KW.sync.refreshCounts(); });
      return KW.db.kvGet('pendingJoin');
    }).then(function (pj) {
      if (pj && S.me && S.me.role === 'foreman') {
        KW.db.kvDel('pendingJoin');
        app.go('#/join?site=' + encodeURIComponent(pj.site) + '&k=' + encodeURIComponent(pj.k) + '&n=' + encodeURIComponent(pj.n), true);
        return;
      }
      var cur = parseHash().path;
      app.go((cur === '/register' || cur === '/locked') ? '#/' : (location.hash || '#/'), true);
    });
  };

  /* ---- グローバルなエラー ---- */
  var authHandling = false;
  KW.bus.on('auth:error', function (code, err) {
    if (authHandling) return;
    if (code === 'USER_LOCKED') {
      if (S.me && S.me.status !== 'locked') { S.me.status = 'locked'; app.go('#/locked', true); }
      return;
    }
    if (code === 'CLIENT_OUTDATED') { S.outdated = true; renderBanners(); return; }
    if (code === 'UNAUTHENTICATED' || code === 'DEVICE_REVOKED' || code === 'USER_DISABLED') {
      authHandling = true;
      KW.outbox.blockAll('auth').then(function () { return clearToken(); }).then(function () {
        app.flash = { kind: 'bad', text: KW.errText(err) };
        KW.sync.refreshCounts();
        app.go('#/register', true);
        authHandling = false;
      });
    }
  });
  KW.bus.on('auth:unlocked', function () { if (parseHash().path === '/locked') app.go('#/', true); });
  KW.bus.on('app:error', function (e) { C.toast(t('err.INTERNAL'), 'bad'); void e; });
  window.addEventListener('unhandledrejection', function () { C.toast(t('err.INTERNAL'), 'bad'); });

  KW.bus.on('outbox:counts', function () { renderHeader(); renderBanners(); });
  KW.bus.on('net:changed', function () { renderHeader(); });
  window.addEventListener('online', renderHeader);
  window.addEventListener('offline', renderHeader);

  /* 確認待ち件数のバッジ(QA/責任者) */
  function updateBadge() {
    if (!S.me || S.me.role === 'foreman' || !S.token) { badge.board = 0; renderTabs(); return; }
    KW.data.allSummaries().then(function (list) {
      var n = list.filter(function (r) { return r.status === 'submitted' && !r.claimedBy && (r.actions || []).indexOf('claimReview') >= 0; }).length;
      badge.board = n + (S.joinPending || 0);
      renderTabs();
    });
  }
  KW.bus.on('records:changed', updateBadge);
  KW.bus.on('joins:count', updateBadge);
  KW.bus.on('poll:done', function () {
    if (S.me && S.me.role !== 'foreman' && KW.isOnline()) {
      KW.api.call('listJoinRequests', { statuses: ['pending'] }).then(function (res) {
        if (res.ok) { S.joinPending = res.data.requests.filter(function (r) { return r.canDecide; }).length; updateBadge(); KW.bus.emit('joins:count'); }
      });
    }
  });

  /* ---- 起動 ---- */
  function langFromEnv() { return /^id/i.test(navigator.language || '') ? 'id' : 'ja'; }

  function boot() {
    renderChrome();
    $('view').appendChild(h('p', { class: 'sub' }, t('scr.S00.loading')));
    return KW.db.open().then(function () {
      return Promise.all(['deviceToken', 'me', 'lang', 'bootstrap', 'lastSyncAt', 'skewMs'].map(function (k) { return KW.db.kvGet(k); }));
    }).then(function (v) {
      S.token = v[0] || null; S.me = v[1] || null; S.bootstrap = v[3] || null; S.lastSyncAt = v[4] || null;
      S.skewMs = typeof v[5] === 'number' ? v[5] : 0; // 圏外で起動しても時刻補正(写真スタンプ・経過表示)を使えるように
      S.lang = KW.pickLang(v[2] || (S.me && S.me.lang) || langFromEnv());
      renderChrome(); renderBanners();
      if (!started) { started = true; KW.sync.start(); }
      window.addEventListener('hashchange', function () { route(); });
      if (!S.token) { route(); return null; }
      if (!KW.isOnline()) { route(); return null; }
      return KW.api.call('me', {}).then(function (res) {
        if (res.ok) {
          S.me = res.data.user; KW.db.kvSet('me', S.me);
          return app.startSession();
        }
        if (res.network) { route(); return null; }
        return null; // auth:error ハンドラが遷移する
      });
    }).then(function () { updateBadge(); }).catch(function (e) {
      $('view').appendChild(C.banner('bad', t('msg.storage_error')));
      KW.reportError(e);
    });
  }

  app.boot = boot;
  registerSW();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
