/* time.js: JST固定の整形・skew補正・経過表示(端末TZに依存しない。SPEC §0.4/§8.9) */
(function (root) {
  'use strict';
  var JST_MS = 9 * 3600 * 1000;

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function parse(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var ms = Date.parse(v);
    return isNaN(ms) ? null : ms;
  }
  function parts(ms) {
    var d = new Date(ms + JST_MS);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  /* 'MM/DD HH:mm' */
  function fmt(v) {
    var ms = parse(v); if (ms == null) return '';
    var p = parts(ms);
    return two(p.mo) + '/' + two(p.d) + ' ' + two(p.h) + ':' + two(p.mi);
  }
  /* 'YYYY-MM-DD HH:mm'(写真スタンプ) */
  function fmtFull(v) {
    var ms = parse(v); if (ms == null) return '';
    var p = parts(ms);
    return p.y + '-' + two(p.mo) + '-' + two(p.d) + ' ' + two(p.h) + ':' + two(p.mi);
  }
  /* 'YYYY-MM-DD'(JST日付) */
  function fmtDate(v) {
    var ms = parse(v); if (ms == null) return '';
    var p = parts(ms);
    return p.y + '-' + two(p.mo) + '-' + two(p.d);
  }
  /* ISO8601(+09:00) */
  function toIso(ms) {
    var p = parts(ms);
    return p.y + '-' + two(p.mo) + '-' + two(p.d) + 'T' + two(p.h) + ':' + two(p.mi) + ':' + two(p.s) + '+09:00';
  }
  /* datetime-local の値(JST) */
  function toInput(v) {
    var ms = parse(v); if (ms == null) return '';
    var p = parts(ms);
    return p.y + '-' + two(p.mo) + '-' + two(p.d) + 'T' + two(p.h) + ':' + two(p.mi);
  }
  function fromInput(s) {
    if (!s) return null;
    return /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s) ? s + ':00+09:00' : null;
  }
  function nowMs(skewMs) { return Date.now() + (skewMs || 0); }
  /* 経過: { unit:'min'|'hour', n } */
  function agoParts(thenMs, nowMsVal) {
    var m = Math.max(0, Math.round((nowMsVal - thenMs) / 60000));
    if (m < 60) return { unit: 'min', n: m };
    return { unit: 'hour', n: Math.floor(m / 60) };
  }
  function minutesSince(thenMs, nowMsVal) { return Math.max(0, Math.floor((nowMsVal - thenMs) / 60000)); }

  var api = { JST_MS: JST_MS, parse: parse, parts: parts, fmt: fmt, fmtFull: fmtFull, fmtDate: fmtDate, toIso: toIso, toInput: toInput, fromInput: fromInput, nowMs: nowMs, agoParts: agoParts, minutesSince: minutesSince };
  root.KW = root.KW || {};
  root.KW.time = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
