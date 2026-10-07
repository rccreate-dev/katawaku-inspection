/**
 * Admin.gs — 責任者専用 admin* と名簿検査(SPEC §5.4.7)。
 * 招待コード平文は adminIssueInvite の応答のみ。Events・ログ・シートには残さない。
 */

function adminGuard_(ctx, action) {
  requireAuth_(ctx.actor, action, { params: ctx.params });
}

function joinUrl_(site) {
  var base = String(Cfg.get('appBaseUrl') || '').replace(/\/+$/, '');
  return base + '/#/join?site=' + site.siteId + '&k=' + site.joinKey + '&n=' + encodeURIComponent(site.name);
}

function act_adminListUsers(ctx) {
  adminGuard_(ctx, 'adminListUsers');
  var devs = {};
  Repo.all('Devices').forEach(function (d) { (devs[d.userId] = devs[d.userId] || []).push(d); });
  return {
    users: Repo.all('Users').map(function (u) {
      return {
        userId: u.userId, name: u.name, role: u.role, status: u.status, lang: u.lang || 'ja', email: u.email ? u.email : null,
        qaQualified: !!u.qaQualified, failedCount: u.failedCount || 0, lockedAt: orNull_(u.lockedAt), lastLoginAt: orNull_(u.lastLoginAt),
        devices: (devs[u.userId] || []).map(function (d) {
          return {
            deviceId: d.deviceId, label: d.label || '', platform: d.platform || '', status: d.status,
            registeredAt: d.registeredAt, lastSeenAt: orNull_(d.lastSeenAt)
          };
        })
      };
    })
  };
}

function act_adminIssueInvite(ctx) {
  adminGuard_(ctx, 'adminIssueInvite');
  var p = ctx.params;
  var user = Repo.get('Users', p.userId);
  if (!user) throw new ApiError('NOT_FOUND', 'ユーザーが見つかりません');
  if (user.status === 'locked') throw new ApiError('USER_LOCKED', 'ロック中のユーザーです。先に解除してください');
  if (user.status === 'disabled') throw new ApiError('USER_DISABLED', '停止中のユーザーです');
  if ((p.purpose === 'first' && user.status !== 'invited') || (p.purpose === 'pinReset' && user.status !== 'active')) {
    throw new ApiError('STATE_CONFLICT', '用途とユーザーの状態が合いません', { status: user.status, round: 0 });
  }
  var now = Util.nowIso();
  // 旧コードは即失効
  Repo.where('Invites', 'userId', user.userId).forEach(function (inv) {
    if (inv.usedAt === '') Repo.update('Invites', inv, { usedAt: 'superseded' });
  });
  var code = Util.randomDigits(6);
  var expiresAt = Util.fmtDt(new Date(Util.nowMs() + Cfg.get('inviteTtlHours') * 3600000));
  var inv = Repo.append('Invites', {
    inviteId: Util.newId('i'), userId: user.userId, purpose: p.purpose, codeHash: Auth.hashInvite(user.userId, code),
    expiresAt: expiresAt, usedAt: '', createdBy: ctx.actor.userId, createdAt: now
  });
  Ev.add(ctx, 'invite_issued', { detail: { userId: user.userId, purpose: p.purpose, inviteId: inv.inviteId, expiresAt: expiresAt } });
  return { inviteId: inv.inviteId, code: code, expiresAt: expiresAt };
}

function act_adminUnlockUser(ctx) {
  adminGuard_(ctx, 'adminUnlockUser');
  var user = Repo.get('Users', ctx.params.userId);
  if (!user) throw new ApiError('NOT_FOUND', 'ユーザーが見つかりません');
  if (user.status !== 'locked') throw new ApiError('STATE_CONFLICT', 'ロック中ではありません', { status: user.status, round: 0 });
  Repo.update('Users', user, { failedCount: 0, lockedAt: '', status: 'active', updatedAt: Util.nowIso() });
  Ev.add(ctx, 'user_unlocked', { detail: { userId: user.userId } });
  return { userId: user.userId, status: 'active' };
}

function act_adminSetUserStatus(ctx) {
  adminGuard_(ctx, 'adminSetUserStatus');
  var p = ctx.params;
  if (p.userId === ctx.actor.userId) throw violation_([{ rule: 'FIELD_INVALID', path: 'userId' }]);
  var user = Repo.get('Users', p.userId);
  if (!user) throw new ApiError('NOT_FOUND', 'ユーザーが見つかりません');
  var from = user.status;
  var to = p.status === 'disabled' ? 'disabled' : (user.pinHash ? 'active' : 'invited');
  var patch = { status: to, updatedAt: Util.nowIso() };
  if (to !== 'disabled') { patch.failedCount = 0; patch.lockedAt = ''; }
  Repo.update('Users', user, patch);
  Ev.add(ctx, 'user_status_changed', { detail: { userId: user.userId, from: from, to: to } });
  return { userId: user.userId, status: to };
}

function act_adminRevokeDevice(ctx) {
  adminGuard_(ctx, 'adminRevokeDevice');
  var p = ctx.params;
  var dev = Repo.get('Devices', p.deviceId);
  if (!dev) throw new ApiError('NOT_FOUND', '端末が見つかりません');
  if (dev.status !== 'revoked') {
    Repo.update('Devices', dev, { status: 'revoked', revokedAt: Util.nowIso(), revokedBy: ctx.actor.userId, revokeReason: p.reason || 'admin' });
    Ev.add(ctx, 'device_revoked', { detail: { deviceId: dev.deviceId, userId: dev.userId, reason: p.reason || 'admin' } });
  }
  return { deviceId: dev.deviceId, status: 'revoked' };
}

function act_adminSetAbsence(ctx) {
  adminGuard_(ctx, 'adminSetAbsence');
  var p = ctx.params;
  if (!Repo.get('Users', p.userId)) throw new ApiError('NOT_FOUND', 'ユーザーが見つかりません');
  if (p.dateFrom > p.dateTo) throw violation_([{ rule: 'FIELD_INVALID', path: 'dateTo' }]);
  var b = Repo.append('Absences', {
    absenceId: Util.newId('b'), userId: p.userId, dateFrom: p.dateFrom, dateTo: p.dateTo, reason: p.reason || '',
    registeredBy: ctx.actor.userId, createdAt: Util.nowIso()
  });
  Ev.add(ctx, 'absence_set', { detail: { absenceId: b.absenceId, userId: p.userId, dateFrom: p.dateFrom, dateTo: p.dateTo } });
  return { absence: absenceView_(b) };
}

function act_adminCancelAbsence(ctx) {
  adminGuard_(ctx, 'adminCancelAbsence');
  var b = Repo.get('Absences', ctx.params.absenceId);
  if (!b) throw new ApiError('NOT_FOUND', '不在登録が見つかりません');
  if (!b.cancelledAt) {
    Repo.update('Absences', b, { cancelledAt: Util.nowIso() });
    Ev.add(ctx, 'absence_cancelled', { detail: { absenceId: b.absenceId, userId: b.userId } });
  }
  return { absence: absenceView_(b) };
}

function act_adminGetJoinInfo(ctx) {
  adminGuard_(ctx, 'adminGetJoinInfo');
  var site = Repo.get('Sites', ctx.params.siteId);
  if (!site) throw new ApiError('NOT_FOUND', '現場が見つかりません');
  return { siteId: site.siteId, joinKey: site.joinKey, joinUrl: joinUrl_(site) };
}

function act_adminRotateJoinKey(ctx) {
  adminGuard_(ctx, 'adminRotateJoinKey');
  var site = Repo.get('Sites', ctx.params.siteId);
  if (!site) throw new ApiError('NOT_FOUND', '現場が見つかりません');
  Repo.update('Sites', site, { joinKey: Util.randomAlnum(16), updatedAt: Util.nowIso() });
  Ev.add(ctx, 'joinkey_rotated', { siteId: site.siteId });
  return { joinKey: site.joinKey, joinUrl: joinUrl_(site) };
}

function act_adminValidateRoster(ctx) {
  adminGuard_(ctx, 'adminValidateRoster');
  var today = Util.today();
  var problems = [];
  function add(level, code, siteId, userId, message) {
    problems.push({ level: level, code: code, siteId: siteId || null, userId: userId || null, message: message });
  }
  var sites = Repo.all('Sites').filter(function (s) { return s.status !== 'closed'; });
  var live = Repo.all('Assignments').filter(function (a) {
    return a.active && (!a.validFrom || a.validFrom <= today) && (!a.validTo || a.validTo >= today);
  });
  var mainCount = {};
  sites.forEach(function (s) {
    if (!Util.splitCsv(s.floors).length) add('error', 'SITE_NO_FLOORS', s.siteId, null, s.name + ': 階の選択肢(floors)が未設定です');
    var rows = live.filter(function (a) { return a.siteId === s.siteId; });
    var mains = [], subs = [], seen = {};
    rows.forEach(function (a) {
      var u = Repo.get('Users', a.userId);
      var isQa = a.assignRole === 'qa_main' || a.assignRole === 'qa_sub';
      var roleMatches = !!u && (a.assignRole === 'qa_main' ? u.role === 'qa'
        : a.assignRole === 'qa_sub' ? (u.role === 'qa' || u.role === 'lead')
          : u.role === 'foreman');
      var uname = u ? u.name : a.userId;
      if (!roleMatches) {
        add('error', 'ROLE_MISMATCH', s.siteId, a.userId, s.name + ': ' + uname + ' の役割と担当(' + a.assignRole + ')が一致しません(兼任不可)');
      } else {
        if (isQa && !u.qaQualified) add('error', 'QA_NOT_QUALIFIED', s.siteId, a.userId, s.name + ': ' + uname + ' は資格者(qaQualified)ではありません');
        if (assignmentRoleOk_(a, u)) {
          if (a.assignRole === 'qa_main') mains.push(a.userId);
          if (a.assignRole === 'qa_sub') subs.push(a.userId);
        }
      }
      var k = a.siteId + '|' + a.userId + '|' + a.assignRole;
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] === 2) add('warn', 'DUPLICATE_ASSIGNMENT', s.siteId, a.userId, s.name + ': ' + uname + ' の同じ担当が重複しています');
    });
    if (mains.length === 0) add('error', 'SITE_NO_QA_MAIN', s.siteId, null, s.name + ': 有効な主担当QAがいません');
    if (mains.length > 1) add('error', 'SITE_MULTI_QA_MAIN', s.siteId, null, s.name + ': 主担当QAが複数います');
    if (subs.length === 0) add('error', 'SITE_NO_QA_SUB', s.siteId, null, s.name + ': 代行者がいません');
    mains.forEach(function (m) {
      if (subs.indexOf(m) >= 0) add('error', 'QA_MAIN_EQ_SUB', s.siteId, m, s.name + ': 主担当QAと代行者が同一人物です');
      mainCount[m] = (mainCount[m] || 0) + 1;
    });
  });
  var max = Cfg.get('qaMaxSitesPerDay');
  Object.keys(mainCount).forEach(function (uid) {
    if (mainCount[uid] > max) add('warn', 'QA_OVERLOAD', null, uid, (userName_(uid) || uid) + ' の主担当現場が' + mainCount[uid] + '件です(目安' + max + '件)');
  });
  return { problems: problems };
}
