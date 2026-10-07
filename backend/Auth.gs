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
      lang: user.lang || 'ja', email: user.email ? user.email : null
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

  /** 招待コード検証。誤りは同じカウンタに加算。成功したら使用済みにする */
  verifyInvite_: function (ctx, user, code, purpose) {
    var rows = Repo.where('Invites', 'userId', user.userId).filter(function (r) { return r.usedAt === ''; });
    var latest = rows.length ? rows[rows.length - 1] : null;
    if (!latest || latest.purpose !== purpose) this.fail_(ctx, user, 'registerDevice', 'INVITE_INVALID');
    if (!Util.safeEqual(this.hashInvite(user.userId, code), latest.codeHash)) this.fail_(ctx, user, 'registerDevice', 'INVITE_INVALID');
    var exp = Util.dtToDate(latest.expiresAt);
    if (!exp || exp.getTime() < Util.nowMs()) throw new ApiError('INVITE_EXPIRED', '招待コードの有効期限が切れています');
    Repo.update('Invites', latest, { usedAt: Util.nowIso() });
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

function act_listLoginUsers(ctx) {
  var list = Repo.all('Users').filter(function (u) { return u.status !== 'disabled'; }).map(function (u) {
    return { userId: u.userId, name: u.name, nameKana: u.nameKana || '', status: u.status };
  });
  list.sort(function (a, b) {
    var ka = a.nameKana || a.name, kb = b.nameKana || b.name;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  return { users: list };
}

function act_registerDevice(ctx) {
  var p = ctx.params, v = [];
  if (!/^\d{4}$/.test(p.pin)) v.push({ rule: 'FIELD_INVALID', path: 'pin' });
  if (p.inviteCode !== undefined && !/^\d{6}$/.test(p.inviteCode)) v.push({ rule: 'FIELD_INVALID', path: 'inviteCode' });
  if (v.length) throw new ApiError('VALIDATION_FAILED', '入力が不正です', { violations: v });
  var user = Repo.get('Users', p.userId);
  if (!user) throw new ApiError('NOT_FOUND', 'ユーザーが見つかりません');
  if (user.status === 'disabled') throw new ApiError('USER_DISABLED', 'アカウントが停止されています');
  if (user.status === 'locked') throw new ApiError('USER_LOCKED', 'ロックされています');
  var now = Util.nowIso();
  var evCtx = { actor: { userId: user.userId, role: user.role }, device: null, clientId: '' };

  if (user.status === 'invited') {
    if (p.inviteCode === undefined) throw new ApiError('INVITE_REQUIRED', '招待コードが必要です');
    Auth.verifyInvite_(ctx, user, p.inviteCode, 'first');
    Repo.update('Users', user, Object.assign(Auth.setNewPin_(user, p.pin), { status: 'active' }));
    Ev.add(evCtx, 'pin_changed', { detail: { via: 'invite_first' } });
  } else if (p.inviteCode !== undefined) {
    Auth.verifyInvite_(ctx, user, p.inviteCode, 'pinReset');
    Repo.update('Users', user, Auth.setNewPin_(user, p.pin));
    Ev.add(evCtx, 'pin_changed', { detail: { via: 'invite_reset' } });
  } else {
    Auth.verifyPin(ctx, user, p.pin, 'registerDevice');
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
