// モック共通ユーティリティ(時刻・ハッシュ・ID)。依存はNode標準のみ。
'use strict';
const crypto = require('crypto');

const JST_MS = 9 * 3600 * 1000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

// --- 仮想時計 -----------------------------------------------------------
let offsetMs = 0;
const now = () => Date.now() + offsetMs;
const setNow = (ms) => { offsetMs = ms - Date.now(); };
const advance = (ms) => { offsetMs += ms; };
const resetClock = () => { offsetMs = 0; };
const getOffset = () => offsetMs;
const setOffset = (v) => { offsetMs = v; };

// --- 日時(§0.4。常に +09:00) ---------------------------------------------
function fmtDt(ms) {
  const d = new Date(ms + JST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
}
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function isDtInput(s) {
  return typeof s === 'string' && DT_RE.test(s) && !Number.isNaN(Date.parse(s));
}
const parseDt = (s) => Date.parse(s);
const normDt = (s) => fmtDt(Date.parse(s));
function jstDate(ms) {
  const d = new Date(ms + JST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
// JSTの日付文字列の hour:min のUTCミリ秒
function jstAt(dateStr, hour, min = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, min) - JST_MS;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return jstDate(Date.UTC(y, m - 1, d + n, 12) - JST_MS);
}
const stampMinute = (ms) => fmtDt(ms).slice(0, 16).replace('T', ' ');

// --- ハッシュ ------------------------------------------------------------
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');
function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJSON(x))).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// --- 乱数・ID ------------------------------------------------------------
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randStr(n, alphabet = ALNUM) {
  let s = '';
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
const newId = (prefix) => `${prefix}_${randStr(12)}`;
const randHex = (nBytes) => crypto.randomBytes(nBytes).toString('hex');

// --- バージョン比較 --------------------------------------------------------
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

module.exports = { now, setNow, advance, resetClock, getOffset, setOffset, fmtDt, isDtInput, parseDt, normDt, jstDate, isDateStr, jstAt, addDays, stampMinute, sha256, hmac, canonicalJSON, safeEq, randStr, newId, randHex, cmpVersion, JST_MS };
