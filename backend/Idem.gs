/**
 * Idem.gs — 冪等キー(SPEC §5.2)と Events 追記(§2.11)。
 * Events は追記専用。PIN・トークン・招待コード平文は detail に残さない。
 */
var Idem = {
  /** ロック内で呼ぶ。既存キーがあれば検査して行を返す(無ければ null)。内容違いは IDEMPOTENCY_CONFLICT */
  check: function (ctx) {
    var row = Repo.where('Idem', 'clientId', ctx.clientId)[0];
    if (!row) return null;
    var hash = Util.paramsHash(ctx.action, ctx.params);
    if (row.userId !== ctx.actor.userId || row.action !== ctx.action || row.paramsHash !== hash) {
      throw new ApiError('IDEMPOTENCY_CONFLICT', '同じclientIdで内容が異なります');
    }
    return row;
  },
  /** 成功応答のみ保存(responseJson は pin を含まない data のJSON。RecordDetail系は空) */
  save: function (ctx, responseJson) {
    if (responseJson.length > 45000) responseJson = '';
    Repo.append('Idem', {
      clientId: ctx.clientId, userId: ctx.actor.userId, action: ctx.action,
      paramsHash: Util.paramsHash(ctx.action, ctx.params), responseJson: responseJson, createdAt: Util.nowIso()
    });
  }
};

var Ev = {
  SECRET_KEYS: ['pin', 'newPin', 'inviteCode', 'code', 'deviceToken', 'token', 'secret', 'pinHash', 'pinSalt', 'tokenHash', 'codeHash', 'password'],

  strip_: function (v) {
    var self = this;
    if (Array.isArray(v)) return v.map(function (x) { return self.strip_(x); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) {
        if (self.SECRET_KEYS.indexOf(k) >= 0) return;
        o[k] = self.strip_(v[k]);
      });
      return o;
    }
    return v;
  },

  /** 40,000文字を超える場合は項目の注記を切り詰める */
  fit_: function (detail) {
    if (detail === null || detail === undefined) return null;
    var s = JSON.stringify(detail);
    if (s.length <= 40000) return detail;
    var d = JSON.parse(s);
    if (Array.isArray(d.items)) {
      d.items.forEach(function (it) { if (it && typeof it.note === 'string') it.note = it.note.slice(0, 100); });
      if (JSON.stringify(d).length > 40000) d.items.forEach(function (it) { if (it) delete it.note; });
      if (JSON.stringify(d).length > 40000) d.items = [];
      d.truncated = true;
    }
    if (typeof d.comment === 'string' && JSON.stringify(d).length > 40000) d.comment = d.comment.slice(0, 500);
    return d;
  },

  /**
   * Events に1行追記。o = {siteId, recordId, from, to, round, detail, actorUserId, actorRole, deviceId}
   * システム実行(ctx.actor なし)は actorUserId='system'
   */
  add: function (ctx, kind, o) {
    o = o || {};
    var actor = ctx && ctx.actor;
    var detail = o.detail === undefined ? null : this.fit_(this.strip_(o.detail));
    return Repo.append('Events', {
      eventId: Util.newId('e'), at: Util.nowIso(), kind: kind,
      siteId: o.siteId || '', recordId: o.recordId || '',
      actorUserId: o.actorUserId || (actor ? actor.userId : 'system'),
      actorRole: o.actorRole || (actor ? actor.role : 'system'),
      deviceId: o.deviceId !== undefined ? o.deviceId : (ctx && ctx.device ? ctx.device.deviceId : ''),
      fromStatus: o.from || '', toStatus: o.to || '',
      round: o.round === undefined ? null : o.round,
      clientId: (ctx && ctx.clientId) || '',
      detail: detail
    });
  }
};

/** ユーザー名の解決(表示用。IDで結合する) */
function userName_(userId) {
  if (!userId) return null;
  var u = Repo.get('Users', userId);
  return u ? u.name : (userId === 'system' ? 'システム' : null);
}
