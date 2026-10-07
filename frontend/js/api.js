/* api.js: GAS互換API呼び出し(SPEC §1.4/§1.5)。text/plain・redirect:follow・封筒・タイムアウト・エラー正規化 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};

  var TIMEOUTS = { uploadPhotoChunk: 60000, getPhoto: 60000, generateReport: 120000 };
  var AUTH_CODES = { UNAUTHENTICATED: 1, DEVICE_REVOKED: 1, USER_DISABLED: 1, USER_LOCKED: 1, CLIENT_OUTDATED: 1 };
  var PUBLIC = { ping: 1, listLoginUsers: 1, registerDevice: 1 };
  var savedSkew = 0;

  /*
   * call(action, params, opts) -> Promise<{ok, data?, error?, meta?, network?}>
   * 例外は投げない。通信失敗は { ok:false, network:true, error:{code:'NETWORK'} }。
   * opts: { clientId, pin, timeoutMs, silentAuth }
   */
  function call(action, params, opts) {
    opts = opts || {};
    var cfg = KW.config;
    if (navigator.onLine === false) {
      return Promise.resolve({ ok: false, network: true, error: { code: 'NETWORK', message: 'offline' } });
    }
    var env = {
      v: 1, action: action,
      appVersion: cfg.APP_VERSION || '1.0.0',
      sentAt: KW.time.toIso(Date.now() + (KW.state.skewMs || 0)),
      params: params || {}
    };
    if (opts.clientId) env.clientId = opts.clientId;
    if (!PUBLIC[action] && KW.state.token) env.deviceToken = KW.state.token;
    if (opts.pin) env.pin = opts.pin;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = opts.timeoutMs || TIMEOUTS[action] || 30000;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;

    return fetch(cfg.API_URL, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(env),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { body = null; }
        return { status: res.status, body: body };
      });
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      var b = r.body;
      if (!b || typeof b.ok !== 'boolean') {
        return { ok: false, network: true, error: { code: 'INTERNAL', message: 'bad response' } };
      }
      if (b.meta && b.meta.serverTime) {
        var st = KW.time.parse(b.meta.serverTime);
        if (st != null) {
          KW.state.skewMs = st - Date.now();
          // 圏外で起動しても補正できるよう IndexedDB(kv.skewMs)に保存。毎回は書かず、1秒以上動いたときだけ
          if (Math.abs(KW.state.skewMs - savedSkew) > 1000) {
            savedSkew = KW.state.skewMs;
            try { KW.db.kvSet('skewMs', savedSkew).catch(function () { /* 無視 */ }); } catch (e) { /* 無視 */ }
          }
        }
      }
      KW.state.netFails = 0;
      if (!b.ok) {
        var err = b.error || { code: 'INTERNAL' };
        if (AUTH_CODES[err.code] && !opts.silentAuth && !PUBLIC[action]) KW.bus.emit('auth:error', err.code, err);
        return { ok: false, error: err, meta: b.meta };
      }
      return { ok: true, data: b.data, meta: b.meta };
    }, function (e) {
      if (timer) clearTimeout(timer);
      KW.state.netFails = (KW.state.netFails || 0) + 1;
      return { ok: false, network: true, error: { code: 'NETWORK', message: String(e && e.message || e) } };
    });
  }

  /* 内部エラーコードの分類(再試行すべきか) */
  function isRetryable(res) {
    if (res.network) return true;
    var c = res.error && res.error.code;
    return c === 'LOCK_TIMEOUT' || c === 'INTERNAL' || c === 'DRIVE_ERROR';
  }

  KW.api = { call: call, isRetryable: isRetryable };
})(window);
