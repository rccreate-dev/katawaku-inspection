/**
 * Repo.gs — シート読み書き(型変換・リクエスト内キャッシュ・追記専用の保護)。
 * 全セルは書式なしテキスト。ここで SCHEMA の型に従って文字列⇄値を変換する。
 * リクエスト開始時と(更新系は)ロック取得直後に Repo.resetCache() を呼ぶこと。
 */
var Repo = (function () {
  var R = {};
  var tables = {};   // 全件読み込み済みシート: name -> {rows, byPk}
  var sheets = {};   // シートオブジェクトのキャッシュ
  var spreadsheet = null;
  /** リクエスト内の一時メモ(Authz 等が使う。resetCache で破棄) */
  R.rc = {};

  R.resetCache = function () {
    tables = {}; sheets = {}; spreadsheet = null; R.rc = {};
  };

  R.ss = function () {
    if (spreadsheet) return spreadsheet;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    spreadsheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error('スプレッドシートが見つかりません(setupSecrets を実行してください)');
    return spreadsheet;
  };

  R.sheet = function (name) {
    if (!sheets[name]) {
      var sh = R.ss().getSheetByName(name);
      if (!sh) throw new Error('シートがありません: ' + name + '(setupSheets を実行してください)');
      sheets[name] = sh;
    }
    return sheets[name];
  };

  /* ---------- 型変換 ---------- */
  function fromCell(type, v) {
    if (v === null || v === undefined) v = '';
    if (v instanceof Date) {
      return type === 'date' ? Util.dateOf(v) : Util.fmtDt(v);
    }
    switch (type) {
      case 'int':
      case 'num':
        if (v === '') return null;
        var n = Number(v);
        return isNaN(n) ? null : n;
      case 'bool':
        return v === true || String(v).toUpperCase() === 'TRUE';
      case 'json':
        if (v === '') return null;
        try { return JSON.parse(String(v)); } catch (e) { return null; }
      default:
        return String(v);
    }
  }
  function toCell(type, v) {
    if (v === null || v === undefined) return '';
    switch (type) {
      case 'bool': return (v === true || v === 'TRUE') ? 'TRUE' : (v === false || v === 'FALSE' ? 'FALSE' : '');
      case 'json': return JSON.stringify(v);
      case 'int':
      case 'num': return v === '' ? '' : String(v);
      default: return String(v);
    }
  }
  function toObj(def, vals, rowNo) {
    var o = {};
    for (var i = 0; i < def.columns.length; i++) o[def.columns[i].name] = fromCell(def.columns[i].type, vals[i]);
    Object.defineProperty(o, '_r', { value: rowNo, enumerable: false, writable: true });
    return o;
  }
  function toRow(def, obj) {
    return def.columns.map(function (c) { return toCell(c.type, obj[c.name]); });
  }
  R.toCell = toCell;
  R.fromCell = fromCell;

  /** シートから全行を読み込んで {rows, byPk} を作る(キャッシュを使わない) */
  function loadFromSheet(name) {
    var def = SCHEMA[name];
    var sh = R.sheet(name);
    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        var o = toObj(def, vals[i], i + 2);
        if (o[def.pk] === '') continue;
        rows.push(o);
      }
    }
    return rows;
  }
  function indexRows(name, rows) {
    var pkName = SCHEMA[name].pk, byPk = {};
    rows.forEach(function (o) {
      if (!Object.prototype.hasOwnProperty.call(byPk, o[pkName])) byPk[o[pkName]] = o;
    });
    return { rows: rows, byPk: byPk };
  }

  function load(name) {
    if (tables[name]) return tables[name];
    // Config/Items/Sites だけは60秒の読み取りキャッシュを使う(SPEC §2.15。RefCache.gs)
    var rows = RefCache.has(name) ? RefCache.read(name) : null;
    if (!rows) {
      rows = loadFromSheet(name);
      RefCache.write(name, rows);
    }
    tables[name] = indexRows(name, rows);
    return tables[name];
  }

  /**
   * そのシートをキャッシュを使わず最新で読み直す(以後このリクエスト内はその結果を使う)。
   * 合言葉(joinKey)を扱う requestJoin/adminGetJoinInfo/adminRotateJoinKey の Sites、
   * 行番号を使って更新する場合、setupSheets などで使う(SPEC §2.15 の3)。
   */
  R.fresh = function (name) {
    delete tables[name];
    if (name === 'Config') delete R.rc.cfg;
    tables[name] = indexRows(name, loadFromSheet(name));
    return tables[name].rows;
  };

  /** 全行(読み取り専用として扱う。変更は update 経由) */
  R.all = function (name) { return load(name).rows; };

  /** 主キーで1行(無ければ null) */
  R.get = function (name, pk) {
    if (pk === undefined || pk === null || pk === '') return null;
    var def = SCHEMA[name];
    if (tables[name] || FULL_LOAD_SHEETS.indexOf(name) >= 0) {
      var t = load(name).byPk;
      return Object.prototype.hasOwnProperty.call(t, pk) ? t[pk] : null;
    }
    var r = R.where(name, def.pk, pk);
    return r.length ? r[0] : null;
  };

  /** 列の値で検索。全件読み込み済みならメモリ、そうでなければその列だけ読んで該当行を取得 */
  R.where = function (name, col, val) {
    var def = SCHEMA[name];
    var sval = String(val);
    if (tables[name]) {
      return tables[name].rows.filter(function (o) { return String(o[col]) === sval; });
    }
    var idx = -1;
    for (var i = 0; i < def.columns.length; i++) if (def.columns[i].name === col) idx = i;
    if (idx < 0) throw new Error('列がありません: ' + name + '.' + col);
    var sh = R.sheet(name);
    var last = sh.getLastRow();
    if (last < 2) return [];
    var colVals = sh.getRange(2, idx + 1, last - 1, 1).getValues();
    var hit = [];
    for (var j = 0; j < colVals.length; j++) if (String(colVals[j][0]) === sval) hit.push(j + 2);
    var out = [];
    var k = 0;
    while (k < hit.length) {
      var start = hit[k], end = start;
      while (k + 1 < hit.length && hit[k + 1] === end + 1) { k++; end = hit[k]; }
      var vals = sh.getRange(start, 1, end - start + 1, def.columns.length).getValues();
      for (var m = 0; m < vals.length; m++) out.push(toObj(def, vals[m], start + m));
      k++;
    }
    return out;
  };

  /** 書き込み後にリクエスト内メモを無効化 */
  function dirty(name, appended) {
    if (name === 'Assignments' || name === 'Users' || name === 'Absences') delete R.rc.effAssign;
    if (name === 'Config') delete R.rc.cfg;
    if (name === 'Reports') delete R.rc.reportIdx;
    if (name === 'RecordItems' && appended) delete R.rc.itemsIdx;
  }

  function ensureCapacity(sh, needRow) {
    var max = sh.getMaxRows();
    if (needRow > max) sh.insertRowsAfter(max, Math.max(needRow - max, 200));
  }

  /** 1行追記して返す(_r 付き) */
  R.append = function (name, obj) { return R.appendMany(name, [obj])[0]; };

  /** 複数行を1回の書き込みで追記 */
  R.appendMany = function (name, objs) {
    if (!objs.length) return [];
    var def = SCHEMA[name];
    var sh = R.sheet(name);
    var first = sh.getLastRow() + 1;
    if (first < 2) first = 2;
    ensureCapacity(sh, first + objs.length - 1);
    var rows = objs.map(function (o) { return toRow(def, o); });
    var range = sh.getRange(first, 1, rows.length, def.columns.length);
    try {
      range.setNumberFormat('@');
      range.setValues(rows);
    } finally {
      RefCache.drop(name); // 書込み直後に破棄(対象シートのみ。SPEC §2.15 の4)
    }
    var out = objs.map(function (o, i) {
      var n = {};
      def.columns.forEach(function (c) { n[c.name] = fromCell(c.type, rows[i][def.columns.indexOf(c)]); });
      Object.defineProperty(n, '_r', { value: first + i, enumerable: false, writable: true });
      return n;
    });
    dirty(name, true);
    if (tables[name]) {
      out.forEach(function (n) {
        tables[name].rows.push(n);
        if (!Object.prototype.hasOwnProperty.call(tables[name].byPk, n[def.pk])) tables[name].byPk[n[def.pk]] = n;
      });
    }
    return out;
  };

  /** 変更した列だけ書き込む(追記専用シートは禁止)。obj も更新して返す */
  R.update = function (name, obj, patch) {
    var def = SCHEMA[name];
    if (def.appendOnly) throw new Error('追記専用シートは更新できません: ' + name);
    if (!obj || !obj._r) throw new Error('更新対象の行が不明です: ' + name);
    var changed = [];
    def.columns.forEach(function (c, i) {
      if (!Object.prototype.hasOwnProperty.call(patch, c.name)) return;
      var nv = patch[c.name];
      if (toCell(c.type, nv) !== toCell(c.type, obj[c.name])) changed.push(i);
      obj[c.name] = fromCell(c.type, toCell(c.type, nv));
    });
    if (!changed.length) return obj;
    dirty(name, false);
    var sh = R.sheet(name);
    try {
      if (changed.length <= 4) {
        changed.forEach(function (i) {
          sh.getRange(obj._r, i + 1).setValue(toCell(def.columns[i].type, obj[def.columns[i].name]));
        });
      } else {
        sh.getRange(obj._r, 1, 1, def.columns.length).setValues([toRow(def, obj)]);
      }
    } finally {
      RefCache.drop(name); // 書込み直後に破棄(対象シートのみ。SPEC §2.15 の4)
    }
    return obj;
  };

  /** Idem の保守削除専用(古い行)。下から削除して行ずれを防ぐ */
  R.purgeIdem = function (olderThanMs) {
    var sh = R.sheet('Idem');
    var last = sh.getLastRow();
    if (last < 2) return 0;
    var vals = sh.getRange(2, 6, last - 1, 1).getValues(); // createdAt 列
    var cutoff = Util.nowMs() - olderThanMs, del = [];
    for (var i = 0; i < vals.length; i++) {
      var d = Util.dtToDate(String(vals[i][0]));
      if (d && d.getTime() < cutoff) del.push(i + 2);
    }
    for (var j = del.length - 1; j >= 0; j--) sh.deleteRow(del[j]);
    delete tables['Idem'];
    return del.length;
  };

  /** 外部(harness の patch 等)で書き換えた後に呼ぶ */
  R.invalidate = function () { tables = {}; R.rc = {}; };

  return R;
})();

/** Config アクセサ(型付き。無ければ既定値) */
var Cfg = {
  _map: function () {
    if (!Repo.rc.cfg) {
      var m = {};
      DEFAULT_CONFIG.forEach(function (c) { m[c.key] = { value: c.value, type: c.type }; });
      Repo.all('Config').forEach(function (r) { m[r.key] = { value: r.value, type: r.type || (m[r.key] && m[r.key].type) || 'str' }; });
      Repo.rc.cfg = m;
    }
    return Repo.rc.cfg;
  },
  get: function (key) {
    var e = this._map()[key];
    if (!e) return null;
    switch (e.type) {
      case 'int': var i = parseInt(e.value, 10); return isNaN(i) ? parseInt(this._def(key), 10) : i;
      case 'num': var n = Number(e.value); return isNaN(n) ? Number(this._def(key)) : n;
      case 'bool': return String(e.value).toUpperCase() === 'TRUE';
      default: return String(e.value);
    }
  },
  _def: function (key) {
    for (var i = 0; i < DEFAULT_CONFIG.length; i++) if (DEFAULT_CONFIG[i].key === key) return DEFAULT_CONFIG[i].value;
    return '';
  },
  pub: function () {
    var o = {};
    var self = this;
    PUBLIC_CONFIG_KEYS.forEach(function (k) { o[k] = self.get(k); });
    return o;
  }
};
