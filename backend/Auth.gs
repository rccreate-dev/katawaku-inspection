/**
 * Auth.gs — 端末登録・deviceToken・PIN/招待コード・stepUp検証・ロック(SPEC §3)。
 * PIN・招待コード・deviceToken の平文は保存・ログ出力しない。
 */
var Auth = {
  pepper: function () {
    var p = PropertiesService.getScriptProperties().getProperty('PIN_PEPPER');
    if (!p) throw new Error('PIN_PEPPER が未設定です(setupSecrets を実行してください)');
    return p;
  },
  hashPin: function (salt, userId, pin) {
    return Util.hmacHex(this.pepper(), salt + ':' + userId + ':' + pin);
  },
  hashInvite: function (userId, code) {
    return Util.hmacHex(this.pepper(), 'invite:' + userId + ':' + code);
  },

  meView: function (user) {
    return {
      userId: user.userId, name: user.name, role: user.role,
      status: user.status === 'locked' ? 'locked' : 'active',
      company: user.company || '', lang: user.lang || 'ja', email: user.email ? user.email : null
    };
  },

  /** deviceToken から {actor,user,device} を導出。リクエストの申告は一切使わない(SPEC §1.6 の4・5) */
  authenticate: function (token, action) {
    var bad = function () { return new ApiError('UNAUTHENTICATED', '認証されていません'); };
    if (typeof token !== 'string') throw bad();
    var i = token.indexOf('.');
    if (i < 1) throw bad();
    var deviceId = token.slice(0, i), secret = token.slice(i + 1);
    if (!Util.isId(deviceId, 'd') || !/^[0-9a-f]{48}$/.test(secret)) throw bad();
    var dev = Repo.get('Devices', deviceId);
    if (!dev) throw bad();
    if (!Util.safeEqual(Util.sha256Hex(secret), dev.tokenHash)) throw bad();
    if (dev.status === 'revoked') throw new ApiError('DEVICE_REVOKED', 'この端末は登録解除されています');
    var user = Repo.get('Users', dev.userId);
    if (!user) throw bad();
    if (user.status === 'disabled') throw new ApiError('USER_DISABLED', 'アカウントが停止されています');
    if (user.status === 'locked' && action !== 'me' && action !== 'logoutDevice') {
      throw new ApiError('USER_LOCKED', 'ロックされています。責任者に解除を依頼してください');
    }
    var last = Util.dtToDate(dev.lastSeenAt);
    if (!last || Util.nowMs() - last.getTime() >= 10 * 60000) {
      Repo.update('Devices', dev, { lastSeenAt: Util.nowIso() });
    }
    return { actor: { userId: user.userId, role: user.role, status: user.status, name: user.name }, user: user, device: dev };
  },

  /** PIN誤りの記録(ユーザー単位カウンタ)。5回でロック。必ず例外を投げる */
  fail_: function (ctx, user, action, code) {
    var max = Cfg.get('pinMaxFail');
    var n = (user.failedCount || 0) + 1;
    var patch = { failedCount: n, updatedAt: Util.nowIso() };
    var locking = n >= max;
    if (locking) { patch.status = 'locked'; patch.lockedAt = Util.nowIso(); }
    Repo.update('Users', user, patch);
    var evCtx = { actor: { userId: user.userId, role: user.role }, device: ctx && ctx.device, clientId: ctx && ctx.clientId };
    var siteId = ctx && ctx.params && ctx.params.siteId ? ctx.params.siteId : '';
    var recordId = ctx && ctx.params && ctx.params.recordId ? ctx.params.recordId : '';
    Ev.add(evCtx, 'pin_failed', { siteId: siteId, recordId: recordId, detail: { action: action, remaining: Math.max(0, max - n) } });
    if (locking) {
      Ev.add(evCtx, 'pin_locked', { siteId: siteId, recordId: recordId, detail: { action: action } });
      throw new ApiError('USER_LOCKED', 'PINを' + max + '回誤ったためロックされました');
    }
    throw new ApiError(code, code === 'PIN_INVALID' ? 'PINが違います' : '招待コードが違います', { remaining: max - n });
  },

  /** stepUp 検証(SPEC §3.4)。権限・状態・入力検証の後に呼ぶ */
  verifyPin: function (ctx, user, pin, action) {
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new ApiError('PIN_REQUIRED', 'PIN(4桁)が必要です');
    if (user.status === 'locked') throw new ApiError('USER_LOCKED', 'ロックされています');
    if (!user.pinHash) throw new ApiError('PIN_REQUIRED', 'PINが未設定です');
    var h = this.hashPin(user.pinSalt, user.userId, pin);
    if (!Util.safeEqual(h, user.pinHash)) this.fail_(ctx, user, action, 'PIN_INVALID');
    if (user.failedCount) Repo.update('Users', user, { failedCount: 0, updatedAt: Util.nowIso() });
  },

  /* ---- 招待コード(SPEC §3.6)。コードから本人を特定する ---- */

  /** 未使用・未失効(期限判定は呼び出し側)の Invites から、コードに一致する1件を探す。{inv,user} か null */
  findInvite_: function (code) {
    var open = Repo.all('Invites').filter(function (r) { return r.usedAt === ''; });
    for (var k = 0; k < open.length; k++) {
      if (Util.safeEqual(this.hashInvite(open[k].userId, code), open[k].codeHash)) {
        return { inv: open[k], user: Repo.get('Users', open[k].userId) };
      }
    }
    return null;
  },

  /** 他の有効なコードと重ならない6桁を作る(findInvite_ が高々1件になるように) */
  newInviteCode_: function () {
    for (var n = 0; n < 50; n++) {
      var c = Util.randomDigits(6);
      if (!this.findInvite_(c)) return c;
    }
    throw new ApiError('INTERNAL', '招待コードを作れませんでした');
  },

  throttleKey_: function () { return 'inviteFail'; },
  /** 窓内の失敗回数が上限に達していれば RATE_LIMITED */
  throttleCheck_: function () {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(this.throttleKey_());
    var st = raw ? JSON.parse(raw) : null;
    if (st && st.n >= Cfg.get('inviteFailMax')) {
      var left = Math.max(1, Math.ceil((st.until - Util.nowMs()) / 1000));
      throw new ApiError('RATE_LIMITED', 'しばらく待ってからやり直してください', { retryAfterSec: left });
    }
  },
  /** 一致しない失敗を1件数える(窓は最初の失敗から inviteFailWindowMin 分) */
  throttleHit_: function (ctx) {
    var cache = CacheService.getScriptCache();
    var winSec = Cfg.get('inviteFailWindowMin') * 60;
    var raw = cache.get(this.throttleKey_());
    var st = raw ? JSON.parse(raw) : null;
    if (!st || st.until <= Util.nowMs()) st = { n: 0, until: Util.nowMs() + winSec * 1000 };
    st.n += 1;
    var ttl = Math.max(1, Math.min(21600, Math.ceil((st.until - Util.nowMs()) / 1000)));
    cache.put(this.throttleKey_(), JSON.stringify(st), ttl);
    Ev.add(null, 'invite_failed', { detail: { count: st.n } });
  },

  /**
   * コードを検証して {inv,user} を返す。使用済みにはしない。
   * 一致なし/停止・ロック中のユーザー → INVITE_INVALID(存在を示さない)、期限切れ → INVITE_EXPIRED
   */
  resolveInvite_: function (ctx, code) {
    this.throttleCheck_();
    var hit = this.findInvite_(code);
    if (!hit || !hit.user || hit.user.status === 'disabled' || hit.user.status === 'locked') {
      this.throttleHit_(ctx);
      throw new ApiError('INVITE_INVALID', '招待コードが違います');
    }
    var exp = Util.dtToDate(hit.inv.expiresAt);
    if (!exp || exp.getTime() < Util.nowMs()) throw new ApiError('INVITE_EXPIRED', '招待コードの有効期限が切れています');
    return hit;
  },

  setNewPin_: function (user, pin) {
    var salt = Util.randomHex(32);
    return { pinSalt: salt, pinHash: this.hashPin(salt, user.userId, pin), failedCount: 0, updatedAt: Util.nowIso() };
  }
};

/* ===================== 公開 ===================== */

function act_ping(ctx) {
  return { apiVersion: API_VERSION, schemaVersion: '1', serverTime: Util.nowIso() };
}

function act_lookupInvite(ctx) {
  var code = ctx.params.inviteCode;
  if (!/^\d{6}$/.test(code)) {
    throw new ApiError('VALIDATION_FAILED', '入力が不正です', { violations: [{ rule: 'FIELD_INVALID', path: 'inviteCode' }] });
  }
  var hit = Auth.resolveInvite_(ctx, code);
  return { name: hit.user.name, company: hit.user.company || '', purpose: hit.inv.purpose };
}

function act_registerDevice(ctx) {
  var p = ctx.params, v = [];
  if (!/^\d{4}$/.test(p.pin)) v.push({ rule: 'FIELD_INVALID', path: 'pin' });
  if (!/^\d{6}$/.test(p.inviteCode)) v.push({ rule: 'FIELD_INVALID', path: 'inviteCode' });
  var company = String(p.company === undefined || p.company === null ? '' : p.company).replace(/\s+/g, ' ').trim();
  if (company.length > 40) v.push({ rule: 'FIELD_INVALID', path: 'company' });
  if (v.length) throw new ApiError('VALIDATION_FAILED', '入力が不正です', { violations: v });
  var hit = Auth.resolveInvite_(ctx, p.inviteCode);
  var user = hit.user;
  // 会社名: 初回登録は必須(責任者が事前に入れた値があれば省略可)。入力があれば名簿(Users.company)を更新する
  if (hit.inv.purpose === 'first' && !company && !user.company) {
    throw new ApiError('VALIDATION_FAILED', '会社名を入力してください', { violations: [{ rule: 'FIELD_INVALID', path: 'company' }] });
  }
  var now = Util.nowIso();
  var evCtx = { actor: { userId: user.userId, role: user.role }, device: null, clientId: '' };

  Repo.update('Invites', hit.inv, { usedAt: now });
  if (company && company !== (user.company || '')) {
    Repo.update('Users', user, { company: company, updatedAt: now });
  }
  if (hit.inv.purpose === 'first') {
    Repo.update('Users', user, Object.assign(Auth.setNewPin_(user, p.pin), { status: 'active' }));
    Ev.add(evCtx, 'pin_changed', { detail: { via: 'invite_first' } });
  } else {
    Repo.update('Users', user, Auth.setNewPin_(user, p.pin));
    Ev.add(evCtx, 'pin_changed', { detail: { via: 'invite_reset' } });
  }

  var deviceId = Util.newId('d');
  var secret = Util.randomHex(48);
  var platform = ['android', 'ios', 'other'].indexOf(p.platform) >= 0 ? p.platform : 'other';
  Repo.append('Devices', {
    deviceId: deviceId, userId: user.userId, tokenHash: Util.sha256Hex(secret),
    label: String(p.deviceLabel || '').slice(0, 40), platform: platform,
    appVersion: p.appVersion || ctx.req.appVersion, status: 'active', registeredAt: now, lastSeenAt: now,
    revokedAt: '', revokedBy: '', revokeReason: ''
  });
  Repo.update('Users', user, { lastLoginAt: now, updatedAt: now });
  Ev.add({ actor: evCtx.actor, device: { deviceId: deviceId } }, 'device_registered', { detail: { platform: platform } });

  // 端末上限(古い順に自動解除)
  var max = Cfg.get('maxDevicesPerUser');
  var active = Repo.where('Devices', 'userId', user.userId).filter(function (d) { return d.status === 'active' && d.deviceId !== deviceId; });
  active.sort(function (a, b) { return String(a.lastSeenAt || a.registeredAt) < String(b.lastSeenAt || b.registeredAt) ? -1 : 1; });
  while (active.length + 1 > max && active.length) {
    var old = active.shift();
    Repo.update('Devices', old, { status: 'revoked', revokedAt: now, revokedBy: 'system', revokeReason: 'auto_prune' });
    Ev.add({ actor: null, device: null }, 'device_revoked', { detail: { deviceId: old.deviceId, reason: 'auto_prune', userId: user.userId } });
  }
  return { deviceId: deviceId, deviceToken: deviceId + '.' + secret, user: Auth.meView(user) };
}

/* ===================== セッション ===================== */

function act_me(ctx) {
  return {
    user: Auth.meView(ctx.user),
    device: { deviceId: ctx.device.deviceId, label: ctx.device.label || '' },
    serverTime: Util.nowIso()
  };
}

function act_setLang(ctx) {
  Repo.update('Users', ctx.user, { lang: ctx.params.lang, updatedAt: Util.nowIso() });
  return { lang: ctx.params.lang };
}

function act_changePin(ctx) {
  var np = ctx.params.newPin;
  if (!/^\d{4}$/.test(np)) {
    throw new ApiError('VALIDATION_FAILED', '新PINは4桁の数字です', { violations: [{ rule: 'FIELD_INVALID', path: 'newPin' }] });
  }
  var auth = authorize(ctx.actor, 'changePin', { params: ctx.params });
  if (!auth.ok) throw new ApiError(auth.code, auth.reason, auth.data);
  ctx.stepUp(); // 現在のPIN(封筒pin)
  Repo.update('Users', ctx.user, Auth.setNewPin_(ctx.user, np));
  Ev.add(ctx, 'pin_changed', { detail: { via: 'changePin' } });
  return { changed: true };
}

function act_logoutDevice(ctx) {
  var now = Util.nowIso();
  Repo.update('Devices', ctx.device, { status: 'revoked', revokedAt: now, revokedBy: ctx.actor.userId, revokeReason: 'logout' });
  Ev.add(ctx, 'device_revoked', { detail: { deviceId: ctx.device.deviceId, reason: 'logout' } });
  return { loggedOut: true };
}

function act_getBootstrap(ctx) {
  var actor = ctx.actor;
  var siteIds = visibleSiteIds(actor);
  var sites = Repo.all('Sites').filter(function (s) { return siteIds.indexOf(s.siteId) >= 0; }).map(function (s) {
    return siteView_(actor, s);
  });
  var items = enabledItems_();
  return {
    user: Auth.meView(ctx.user), sites: sites, items: items.map(itemView_),
    itemsHash: Util.sha256Hex(Util.canonicalJSON(items.map(itemView_))),
    config: Cfg.pub(), serverTime: Util.nowIso()
  };
}

function enabledItems_() {
  var stages = Util.splitCsv(Cfg.get('enabledStages'));
  return Repo.all('Items').filter(function (i) { return i.active && stages.indexOf(i.stage) >= 0; })
    .slice().sort(function (a, b) { return a.seq - b.seq; });
}

function itemView_(i) {
  return {
    itemId: i.itemId, seq: i.seq, stage: i.stage, audience: i.audience, groupKey: i.groupKey,
    groupJa: i.groupJa, groupId: i.groupId, textJa: i.textJa, textId: i.textId, key: !!i.key,
    tol: i.tol === null || i.tol === undefined ? null : i.tol, measure: i.measure, minMeasures: i.minMeasures || 0,
    unit: i.unit || 'mm'
  };
}

function siteView_(actor, s) {
  var main = effectiveAssignmentsFor_(s.siteId, 'qa_main')[0] || null;
  var subs = effectiveAssignmentsFor_(s.siteId, 'qa_sub');
  var today = Util.today();
  var mine = effectiveAssignments_().filter(function (a) { return a.siteId === s.siteId && a.userId === actor.userId; });
  var order = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];
  mine.sort(function (a, b) { return order.indexOf(a.assignRole) - order.indexOf(b.assignRole); });
  var my = mine[0] || null;
  return {
    siteId: s.siteId, name: s.name, status: s.status, floors: Util.splitCsv(s.floors), zones: Util.splitCsv(s.zones),
    primeContractor: s.primeContractor || '',
    qa: {
      main: main ? { userId: main.userId, name: userName_(main.userId) } : null,
      mainAbsent: main ? isAbsent(main.userId, today) : false,
      subs: subs.map(function (a) { return { userId: a.userId, name: userName_(a.userId) }; })
    },
    myAssignRole: my ? my.assignRole : null,
    myTeam: my && my.team ? my.team : null
  };
}
