/**
 * Util.gs — 共通ユーティリティ。
 * 規約: 時刻は Util.now()、ID・乱数は Util.newId()/Util.randomHex() 経由のみ
 * (new Date() / Math.random を他ファイルで直接使わない。harness が時計を差し替えるため)。
 */
var Util = (function () {
  var U = {};
  var JST_MS = 9 * 3600 * 1000;

  /** harness が function() -> epoch ms を差し込む。本番は null */
  U._clock = null;
  U.nowMs = function () { return U._clock ? U._clock() : new Date().getTime(); };
  U.now = function () { return new Date(U.nowMs()); };

  /** Date -> yyyy-MM-dd'T'HH:mm:ss+09:00 (JST固定) */
  U.fmtDt = function (d) {
    var t = new Date(d.getTime() + JST_MS);
    return t.toISOString().slice(0, 19) + '+09:00';
  };
  U.nowIso = function () { return U.fmtDt(U.now()); };

  var DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
  /** オフセット付きISO8601のみ受理。不正は null */
  U.parseDt = function (s) {
    if (typeof s !== 'string') return null;
    var m = DT_RE.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5], ss = m[6] ? +m[6] : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
    var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d > dim) return null;
    var tz = m[7];
    var norm = s;
    if (tz !== 'Z' && tz.length === 5) norm = s.slice(0, -2) + ':' + s.slice(-2);
    var t = Date.parse(norm);
    return isNaN(t) ? null : new Date(t);
  };
  /** 受け取った日時文字列を +09:00 に正規化。不正は null */
  U.normDt = function (s) {
    var d = U.parseDt(s);
    return d ? U.fmtDt(d) : null;
  };
  /** 保存済みdt文字列 -> Date(不正・空は null) */
  U.dtToDate = function (s) { return s ? U.parseDt(String(s)) : null; };
  U.dateOf = function (d) { return U.fmtDt(d).slice(0, 10); };
  U.today = function () { return U.dateOf(U.now()); };
  U.isDate = function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  };
  U.addDays = function (dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000);
    return d.toISOString().slice(0, 10);
  };
  /** JST の日付+時刻から dt 文字列 */
  U.jstDt = function (dateStr, hour, minute) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return dateStr + 'T' + p2(hour) + ':' + p2(minute || 0) + ':00+09:00';
  };

  /* ---------- ID・乱数 ---------- */
  U.randomHex = function (n) {
    var s = '';
    while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
    return s.slice(0, n);
  };
  U.newId = function (prefix) { return prefix + '_' + U.randomHex(12); };
  U.randomDigits = function (n) {
    var s = '';
    while (s.length < n) s += ('0000000000' + (parseInt(U.randomHex(10), 16) % 1000000000)).slice(-9);
    return s.slice(0, n);
  };
  U.randomAlnum = function (n) {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
    var hex = U.randomHex(n * 2);
    for (var i = 0; i < n; i++) s += chars.charAt(parseInt(hex.substr(i * 2, 2), 16) % 36);
    return s;
  };

  /* ---------- ハッシュ ---------- */
  U.bytesToHex = function (bytes) {
    var o = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 255;
      o += (b < 16 ? '0' : '') + b.toString(16);
    }
    return o;
  };
  /** 文字列(UTF-8) またはバイト配列の SHA-256 hex */
  U.sha256Hex = function (v) {
    var d = typeof v === 'string'
      ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8)
      : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v);
    return U.bytesToHex(d);
  };
  U.hmacHex = function (key, message) {
    return U.bytesToHex(Utilities.computeHmacSha256Signature(message, key));
  };
  /** 定数時間比較(文字列) */
  U.safeEqual = function (a, b) {
    a = String(a); b = String(b);
    var len = Math.max(a.length, b.length), diff = a.length ^ b.length;
    for (var i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  };
  /** キーを再帰的に辞書順に並べた最小JSON */
  U.canonicalJSON = function canon(v) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      return '[' + v.map(function (x) { var s = canon(x); return s === undefined ? 'null' : s; }).join(',') + ']';
    }
    var keys = Object.keys(v).sort(), parts = [];
    for (var i = 0; i < keys.length; i++) {
      var s = canon(v[keys[i]]);
      if (s !== undefined) parts.push(JSON.stringify(keys[i]) + ':' + s);
    }
    return '{' + parts.join(',') + '}';
  };
  U.paramsHash = function (action, params) {
    return U.sha256Hex(U.canonicalJSON({ action: action, params: params }));
  };
  U.b64encode = function (bytes) { return Utilities.base64Encode(bytes); };
  U.b64decode = function (s) { return Utilities.base64Decode(s); };

  /* ---------- 文字列・型 ---------- */
  U.isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  U.has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  U.blank = function (s) { return s === null || s === undefined || String(s).trim() === ''; };
  U.sanitizeName = function (s) {
    return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim().slice(0, 60);
  };
  U.semverLt = function (a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) {
      var p = x[i] || 0, q = y[i] || 0;
      if (p !== q) return p < q;
    }
    return false;
  };
  U.splitCsv = function (s) {
    return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  };
  U.uniq = function (arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  };

  var ID_RE = /^[a-z]_[a-z0-9]{1,32}$/;
  U.isId = function (s, prefix) {
    return typeof s === 'string' && ID_RE.test(s) && (!prefix || s.charAt(0) === prefix);
  };
  U.isItemId = function (s) { return typeof s === 'string' && /^i[0-9]{1,4}$/.test(s); };
  /** クライアント生成ID(16桁) */
  U.isClientGenId = function (s, prefix) {
    return typeof s === 'string' && new RegExp('^' + prefix + '_[a-z0-9]{16}$').test(s);
  };

  /**
   * パラメータ検査。spec = { key: {t, req, max, min, values, p, nullable, maxItems} }
   * t: str / id / itemId / int / num / bool / dt / date / enum / arr / obj / any
   * 戻り値: violations 配列(空なら正常)
   */
  U.checkTypes = function (params, spec) {
    var v = [];
    Object.keys(spec).forEach(function (k) {
      var s = spec[k], val = params[k];
      var present = U.has(params, k) && val !== undefined;
      if (!present) { if (s.req) v.push({ rule: 'FIELD_INVALID', path: k }); return; }
      if (val === null) { if (!s.nullable) v.push({ rule: 'FIELD_INVALID', path: k }); return; }
      var ok = true;
      switch (s.t) {
        case 'str':
          ok = typeof val === 'string' && (s.max === undefined || val.length <= s.max) && (s.min === undefined || val.length >= s.min);
          break;
        case 'id': ok = U.isId(val, s.p); break;
        case 'itemId': ok = U.isItemId(val); break;
        case 'int':
          ok = typeof val === 'number' && isFinite(val) && Math.floor(val) === val &&
            (s.min === undefined || val >= s.min) && (s.max === undefined || val <= s.max);
          break;
        case 'num': ok = typeof val === 'number' && isFinite(val); break;
        case 'bool': ok = typeof val === 'boolean'; break;
        case 'dt': ok = U.parseDt(val) !== null; break;
        case 'date': ok = U.isDate(val); break;
        case 'enum': ok = typeof val === 'string' && s.values.indexOf(val) >= 0; break;
        case 'arr':
          ok = Array.isArray(val) && (s.maxItems === undefined || val.length <= s.maxItems) && (s.minItems === undefined || val.length >= s.minItems);
          break;
        case 'obj': ok = U.isObj(val); break;
        default: ok = true;
      }
      if (!ok) v.push({ rule: 'FIELD_INVALID', path: k });
    });
    return v;
  };

  return U;
})();
