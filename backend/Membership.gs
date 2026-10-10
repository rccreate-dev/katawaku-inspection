/**
 * Membership.gs — 参加(QR→承認)・名簿・不在の参照(SPEC §5.4.6, §5.4.7 の参照系)。
 */

function membershipView_(actor, m) {
  var site = Repo.get('Sites', m.siteId);
  var canDecide = m.status === 'pending' && authorize(actor, 'decideJoin', { siteId: m.siteId, membership: m, params: {} }).ok;
  return {
    membershipId: m.membershipId, siteId: m.siteId, siteName: site ? site.name : '', userId: m.userId,
    userName: userName_(m.userId), status: m.status, requestedAt: m.requestedAt,
    decidedBy: orNull_(m.decidedBy), decidedByName: userName_(m.decidedBy), decidedAt: orNull_(m.decidedAt),
    assignRole: orNull_(m.assignRole), team: orNull_(m.team), note: orNull_(m.note), canDecide: canDecide
  };
}

function assignmentView_(a) {
  var site = Repo.get('Sites', a.siteId);
  var eff = effectiveAssignments_().some(function (e) { return e.assignId === a.assignId; });
  return {
    assignId: a.assignId, siteId: a.siteId, siteName: site ? site.name : '', userId: a.userId, userName: userName_(a.userId),
    assignRole: a.assignRole, team: a.team || '', validFrom: a.validFrom, validTo: orNull_(a.validTo), active: !!a.active,
    effective: eff, absentToday: isAbsent(a.userId, Util.today())
  };
}

function absenceView_(b) {
  return {
    absenceId: b.absenceId, userId: b.userId, userName: userName_(b.userId), dateFrom: b.dateFrom, dateTo: b.dateTo,
    reason: b.reason || '', registeredBy: b.registeredBy, registeredByName: userName_(b.registeredBy), createdAt: b.createdAt
  };
}

function act_requestJoin(ctx) {
  var p = ctx.params, actor = ctx.actor;
  requireAuth_(actor, 'requestJoin', { params: p });
  Repo.fresh('Sites'); // 合言葉の照合はキャッシュを使わない(失効が遅れないように。SPEC §2.15 の3)
  var site = Repo.get('Sites', p.siteId);
  if (!site) throw new ApiError('NOT_FOUND', '現場が見つかりません');
  if (!Util.safeEqual(p.joinKey, site.joinKey)) throw new ApiError('JOIN_KEY_INVALID', '合言葉が違います');
  if (site.status === 'closed') throw new ApiError('SITE_CLOSED', '閉鎖された現場です');
  var mine = Repo.all('Memberships').filter(function (m) { return m.siteId === p.siteId && m.userId === actor.userId; });
  var approved = mine.some(function (m) { return m.status === 'approved'; }) ||
    effectiveAssignments_().some(function (a) {
      return a.siteId === p.siteId && a.userId === actor.userId && (a.assignRole === 'foreman' || a.assignRole === 'subforeman');
    });
  if (approved) throw new ApiError('ALREADY_MEMBER', '既に参加済みです');
  var pending = mine.filter(function (m) { return m.status === 'pending'; })[0];
  if (pending) throw new ApiError('JOIN_PENDING', '申請中です', { membershipId: pending.membershipId });
  var m = Repo.append('Memberships', {
    membershipId: Util.newId('m'), siteId: p.siteId, userId: actor.userId, status: 'pending',
    requestedAt: Util.nowIso(), requestClientId: ctx.clientId
  });
  var mailed = Notify.toActingQa(site, null, '参加申請', 'joins');
  Ev.add(ctx, 'join_requested', { siteId: p.siteId, detail: { membershipId: m.membershipId, mailed: mailed } });
  return { membership: membershipView_(actor, m) };
}

function act_listJoinRequests(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var statuses = p.statuses || ['pending'];
  statuses.forEach(function (s) {
    if (['pending', 'approved', 'rejected', 'revoked'].indexOf(s) < 0) throw violation_([{ rule: 'FIELD_INVALID', path: 'statuses' }]);
  });
  var vis = visibleSiteIds(actor);
  var rows = Repo.all('Memberships').filter(function (m) {
    if (statuses.indexOf(m.status) < 0) return false;
    if (p.siteId && m.siteId !== p.siteId) return false;
    if (actor.role === 'foreman') return m.userId === actor.userId;
    return vis.indexOf(m.siteId) >= 0;
  });
  rows.sort(function (a, b) { return a.requestedAt < b.requestedAt ? -1 : (a.requestedAt > b.requestedAt ? 1 : 0); });
  return { requests: rows.map(function (m) { return membershipView_(actor, m); }) };
}

function act_decideJoin(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var m = Repo.get('Memberships', p.membershipId);
  if (!m) throw new ApiError('NOT_FOUND', '申請が見つかりません');
  requireAuth_(actor, 'decideJoin', { siteId: m.siteId, membership: m, params: p });
  if (m.status !== 'pending') throw new ApiError('STATE_CONFLICT', '申請中ではありません', { status: m.status });
  var now = Util.nowIso();
  if (p.decision === 'reject') {
    Repo.update('Memberships', m, { status: 'rejected', decidedBy: actor.userId, decidedAt: now, note: p.note || '' });
    Ev.add(ctx, 'join_rejected', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId } });
    return { membership: membershipView_(actor, m), assignment: null };
  }
  var team = p.team === undefined ? '' : String(p.team).trim();
  if (!team || team.length > 20) throw violation_([{ rule: 'FIELD_INVALID', path: 'team' }]);
  var role = p.assignRole || 'foreman';
  Repo.update('Memberships', m, {
    status: 'approved', decidedBy: actor.userId, decidedAt: now, assignRole: role, team: team, note: p.note || ''
  });
  var a = Repo.append('Assignments', {
    assignId: Util.newId('a'), siteId: m.siteId, userId: m.userId, assignRole: role, team: team,
    validFrom: Util.today(), validTo: '', active: true, createdBy: actor.userId, createdAt: now, updatedAt: now
  });
  Ev.add(ctx, 'join_approved', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId, assignRole: role, team: team } });
  return { membership: membershipView_(actor, m), assignment: assignmentView_(a) };
}

function act_revokeMembership(ctx) {
  var p = ctx.params, actor = ctx.actor;
  var m = Repo.get('Memberships', p.membershipId);
  if (!m) throw new ApiError('NOT_FOUND', '申請が見つかりません');
  requireAuth_(actor, 'revokeMembership', { siteId: m.siteId, membership: m, params: p });
  if (m.status !== 'approved') throw new ApiError('STATE_CONFLICT', '承認済みではありません', { status: m.status });
  var reason = String(p.reason).trim();
  if (!reason) throw violation_([{ rule: 'REASON_REQUIRED' }]);
  var now = Util.nowIso();
  Repo.update('Memberships', m, { status: 'revoked', decidedBy: actor.userId, decidedAt: now, note: reason });
  Repo.all('Assignments').filter(function (a) {
    return a.siteId === m.siteId && a.userId === m.userId && a.active && (a.assignRole === 'foreman' || a.assignRole === 'subforeman');
  }).forEach(function (a) { Repo.update('Assignments', a, { active: false, updatedAt: now }); });
  Ev.add(ctx, 'join_revoked', { siteId: m.siteId, detail: { membershipId: m.membershipId, userId: m.userId, reason: reason } });
  return { membership: membershipView_(actor, m) };
}

function act_listAssignments(ctx) {
  var p = ctx.params, actor = ctx.actor;
  requireAuth_(actor, 'listAssignments', { siteId: p.siteId || null, params: p });
  var vis = visibleSiteIds(actor);
  var order = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];
  var rows = Repo.all('Assignments').filter(function (a) {
    return vis.indexOf(a.siteId) >= 0 && (!p.siteId || a.siteId === p.siteId);
  }).slice();
  rows.sort(function (a, b) {
    if (a.siteId !== b.siteId) return a.siteId < b.siteId ? -1 : 1;
    return order.indexOf(a.assignRole) - order.indexOf(b.assignRole);
  });
  return { assignments: rows.map(assignmentView_) };
}

function act_listAbsences(ctx) {
  requireAuth_(ctx.actor, 'listAbsences', { params: ctx.params });
  var limit = Util.addDays(Util.today(), -7);
  var rows = Repo.all('Absences').filter(function (b) { return !b.cancelledAt && b.dateTo >= limit; });
  rows.sort(function (a, b) { return a.dateFrom < b.dateFrom ? -1 : (a.dateFrom > b.dateFrom ? 1 : 0); });
  return { absences: rows.map(absenceView_) };
}
