/**
 * RefCache.gs — 参照シート(Config / Items / Sites のみ)の読み取りキャッシュ(SPEC §2.15)。
 *   - 対象は SHEETS だけ。権限判定に使うシート(Users/Devices/Assignments/Memberships/Absences)と
 *     Records 系は絶対にキャッシュしない(認可は常に最新のシートで判定する)。
 *   - CacheService(スクリプトキャッシュ)に、キー ref:{シート名}・TTL 最大60秒で保存する。
 *   - 破棄は Repo.gs の書込み関数(append/appendMany/update)が対象シートなら自動で drop() を呼ぶ(漏れ防止)。
 *   - 100KB超・put/get/JSON解釈の失敗は黙って(値をログに出さず)キャッシュなしの通常読み込みに戻す。
 *   - 値は分割保存しない。行番号(_r)も保存する(更新時に必要)。
 * 注意: キャッシュ有無でAPIの契約は変わらない。変わりうるのは、スプレッドシートを直接編集した
 *       Config/Items/Sites の反映が最大60秒遅れることだけ(docs/OPERATIONS.md)。
 */
var RefCache = {
  SHEETS: ['Config', 'Items', 'Sites'],
  TTL_SEC: 60,
  /** 保存しない列(合言葉 joinKey をキャッシュに置かない。読み出し時は空文字。照合・返却する3actionは Repo.fresh) */
  OMIT: { Sites: ['joinKey'] },

  /** キャッシュに載せる列 */
  cols_: function (name) {
    var omit = this.OMIT[name] || [];
    return SCHEMA[name].columns.filter(function (c) { return omit.indexOf(c.name) < 0; });
  },

  has: function (name) { return this.SHEETS.indexOf(name) >= 0; },
  key: function (name) { return 'ref:' + name; },

  /** キャッシュ済みの行を返す({rows:[obj...]})。無い・壊れている・列構成が違うときは null */
  read: function (name) {
    if (!this.has(name)) return null;
    try {
      var s = CacheService.getScriptCache().get(this.key(name));
      if (!s) return null;
      var o = JSON.parse(s);
      var cols = this.cols_(name);
      var all = SCHEMA[name].columns;
      if (!o || o.v !== 1 || o.n !== cols.length || !Array.isArray(o.rows)) return null;
      var rows = [];
      for (var i = 0; i < o.rows.length; i++) {
        var a = o.rows[i];
        if (!Array.isArray(a) || a.length !== cols.length + 1) return null;
        var obj = {};
        for (var c = 0; c < all.length; c++) obj[all[c].name] = Repo.fromCell(all[c].type, '');
        for (var j = 0; j < cols.length; j++) obj[cols[j].name] = a[j + 1];
        Object.defineProperty(obj, '_r', { value: a[0], enumerable: false, writable: true });
        rows.push(obj);
      }
      return rows;
    } catch (e) {
      return null;
    }
  },

  /** 読み込んだ行を保存する。失敗(100KB超など)は黙って無視 */
  write: function (name, rows) {
    if (!this.has(name)) return;
    try {
      var cols = this.cols_(name);
      var out = rows.map(function (r) {
        var a = [r._r];
        for (var j = 0; j < cols.length; j++) a.push(r[cols[j].name]);
        return a;
      });
      CacheService.getScriptCache().put(this.key(name), JSON.stringify({ v: 1, n: cols.length, rows: out }), this.TTL_SEC);
    } catch (e) {
      /* 100KB超・保存失敗: キャッシュを使わない(エラーにしない・値を出さない) */
    }
  },

  /** 書込み直後に呼ぶ(Repo の書込み関数が自動で呼ぶ) */
  drop: function (name) {
    if (!this.has(name)) return;
    try { CacheService.getScriptCache().remove(this.key(name)); } catch (e) { /* 無視 */ }
  }
};

/**
 * GASエディタ専用(Webのactionではない): 参照シートのキャッシュを今すぐ捨てる。
 * Config/Items/Sites を直接編集した直後に、約1分待たずに反映させたいときに実行する(docs/OPERATIONS.md)。
 */
function clearRefCache() {
  RefCache.SHEETS.forEach(function (name) { RefCache.drop(name); });
  return 'OK: 参照シートのキャッシュを破棄しました';
}
