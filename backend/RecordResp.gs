/**
 * RecordResp.gs — 書き込み応答の更新後の記録 data.record(SPEC §5.1a。版1.10)。
 *
 * 対象 action(§5.1a の表が正本): submitRecord / submitVerdict / recordPrimeSign / stopPour / addNote / uploadPhotoChunk(complete:true)。
 * 方針:
 *   - record は getRecord と同じ関数(recordDetail_)で作る。サムネ・写真本体は含めない(PhotoMeta のみ)。
 *   - 作れなかった(例外・canViewDetail でない)ときは書き込みの成否を変えない。従来の形のまま返す(addNote / 写真は record を省く)。
 *   - Idem には従来の形(RecordSummary / masked 形 / {note})で保存する(45,000文字の上限を守る)。
 *     そのため attach は ctx.idemData に「保存する形」を置き、dispatcher(Code.gs)がそれを保存する。
 *   - 冪等再生(replayed)では、保存済みの応答の record だけを再生時点の最新の Detail に差し替える。
 *   - 版(version)は touchRecord_ が書き込みごとに+1する(現行どおり)。採否の判定はクライアント側。
 */
var RecordResp = {
  /** 再生時に record を最新の Detail に差し替える action */
  REPLAY_ACTIONS: ['submitRecord', 'submitVerdict', 'recordPrimeSign', 'stopPour', 'addNote'],

  /** RecordDetail を作る。作れない(見てよい権限がない・例外)ときは null。値や本文はログに出さない */
  detail: function (actor, rec) {
    try {
      if (!actor || !rec || !canViewDetail(actor, rec)) return null;
      return recordDetail_(actor, rec);
    } catch (e) {
      try { console.error('record応答の作成に失敗 recordId=' + (rec && rec.recordId)); } catch (x) { /* 無視 */ }
      return null;
    }
  },

  /**
   * ロックを持ったまま呼ぶ(通常の更新系)。data は従来の形の応答。
   * 戻り値は record を Detail にした応答。ctx.idemData には従来の形(Idem に保存する形)を残す。
   */
  attach: function (ctx, data, rec) {
    ctx.idemData = data;
    var d = this.detail(ctx.actor, rec);
    if (!d) return data;
    return Object.assign({}, data, { record: d });
  },

  /** 冪等再生: 保存済みの応答 stored の record を最新の Detail に差し替える(作れなければ保存済みのまま) */
  onReplay: function (ctx, stored) {
    if (this.REPLAY_ACTIONS.indexOf(ctx.action) < 0 || !stored || typeof stored !== 'object') return stored;
    var rec = null;
    try { rec = Repo.get('Records', ctx.params.recordId); } catch (e) { rec = null; }
    var d = this.detail(ctx.actor, rec);
    if (!d) return stored;
    return Object.assign({}, stored, { record: d });
  },

  /**
   * uploadPhotoChunk 用: ロックを解放したあとに、読み取りだけで作る(§5.1a の2)。
   * 他のリクエストの書き込みを拾えるよう参照キャッシュを破棄して読み直す。作れなければ data を変えない。
   */
  afterUnlock: function (ctx, data, recordId) {
    try {
      Repo.resetCache();
      var d = this.detail(ctx.actor, Repo.get('Records', recordId));
      if (d) return Object.assign({}, data, { record: d });
    } catch (e) {
      try { console.error('record応答の作成に失敗 recordId=' + recordId); } catch (x) { /* 無視 */ }
    }
    return data;
  }
};
