/* perf.js: 通信時間の記録(SPEC §1.9)。api.js が1回の通信ごとに record() を呼ぶ。
 * 往復の時間(端末で測る)と、サーバーが応答に載せた処理時間の内訳(meta.timing)を、直近100件だけ端末に残す。
 * 氏名・PIN・写真などの中身は残さない(action名・時間・結果コードだけ)。診断画面(S21)で見る。 */
(function (root) {
  'use strict';
  var KW = root.KW = root.KW || {};
  var MAX = 100;
  var log = [];
  var loaded = false;
  var saveTimer = null;

  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try { KW.db.kvSet('perfLog', log.slice()).catch(function () { /* 無視 */ }); } catch (e) { /* 無視 */ }
    }, 3000);
  }

  function load() {
    if (loaded) return Promise.resolve();
    loaded = true;
    try {
      return KW.db.kvGet('perfLog').then(function (v) {
        if (Array.isArray(v) && v.length) log = v.concat(log).slice(-MAX);
      }).catch(function () { /* 無視 */ });
    } catch (e) { return Promise.resolve(); }
  }

  function num(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : null; }

  /** e: { action, rtMs, ok, code, network, timing } */
  function record(e) {
    var srv = null;
    if (e.timing && typeof e.timing === 'object') {
      srv = {};
      ['totalMs', 'authMs', 'pinMs', 'lockWaitMs', 'driveMs', 'reads', 'readMs', 'writes', 'writeMs'].forEach(function (k) { srv[k] = num(e.timing[k]) || 0; });
    }
    log.push({ at: Date.now(), action: String(e.action || ''), rtMs: num(e.rtMs) || 0, ok: !!e.ok, code: e.code ? String(e.code) : '', net: !!e.network, srv: srv });
    if (log.length > MAX) log.splice(0, log.length - MAX);
    save();
  }

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  /** 操作(action)ごとの集計。通信失敗(network)は除く。overhead=往復-サーバー内(=端末とGoogleの間の通信+Googleの起動) */
  function summary() {
    var by = {};
    log.forEach(function (e) {
      if (e.net) return;
      var b = by[e.action] || (by[e.action] = { action: e.action, n: 0, rt: [], srv: [], over: [] });
      b.n++; b.rt.push(e.rtMs);
      if (e.srv) { b.srv.push(e.srv.totalMs); b.over.push(Math.max(0, e.rtMs - e.srv.totalMs)); }
    });
    return Object.keys(by).map(function (k) {
      var b = by[k];
      return { action: k, n: b.n, rtMed: median(b.rt), rtMax: Math.max.apply(null, b.rt), srvMed: median(b.srv), overMed: median(b.over) };
    }).sort(function (a, b) { return (b.rtMed || 0) - (a.rtMed || 0); });
  }

  function clear() { log = []; try { KW.db.kvSet('perfLog', []).catch(function () { /* 無視 */ }); } catch (e) { /* 無視 */ } }

  /** 貼り付けて共有できる文字列(中身を含まない) */
  function exportText() {
    var head = 'build ' + ((KW.config && KW.config.APP_BUILD) || '-') + ' / ' + new Date().toISOString();
    var lines = log.slice(-60).map(function (e) {
      var s = e.srv;
      return [new Date(e.at).toISOString().slice(11, 19), e.action, e.net ? 'NETWORK' : (e.ok ? 'ok' : e.code), 'rt=' + e.rtMs,
        s ? ['srv=' + s.totalMs, 'auth=' + s.authMs, 'pin=' + s.pinMs, 'lock=' + s.lockWaitMs, 'drive=' + s.driveMs, 'rd=' + s.reads + '/' + s.readMs, 'wr=' + s.writes + '/' + s.writeMs].join(' ') : 'srv=-'].join(' ');
    });
    return head + '\n' + lines.join('\n');
  }

  KW.perf = { record: record, list: function () { return log.slice(); }, summary: summary, clear: clear, exportText: exportText, load: load };
})(window);
