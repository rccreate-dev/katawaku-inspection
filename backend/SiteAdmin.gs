/**
 * SiteAdmin.gs — 責任者のスマホでの現場管理(SPEC §5.4.8・§6.10。版1.13.0)。
 * 8 action: adminGetSite / adminCreateSite / adminUpdateSite / adminCloseSite / adminReopenSite /
 *           adminAddAssignment / adminEndAssignment / adminCreateUser
 * 書き込みは dispatcher のロック内で実行される(Code.gs runAction_)。検査を全て終えてから書く(途中で失敗したら何も書かない)。
 * Sites は参照キャッシュを使わず読み直す(SPEC §2.15 の3)。書き込み後の参照キャッシュ破棄は Repo が行う(§2.15 の4)。
 * 応答・Events・Idem に joinKey と招待コード平文を入れない(§0.5)。
 */

var SITE_ADMIN_ROLES_ = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];
var SITE_COUNT_KEYS_ = ['draft', 'submitted', 'fix', 'qa_ok', 'approved'];

function siteAdminGuard_(ctx) {
  requireAuth_(ctx.actor, ctx.action, { params: ctx.params });
}

/** 担当表を書いたあと、リクエスト内の有効担当メモを捨てる(Authz の effectiveAssignments_ のメモ) */
function siteAdminDropMemo_() { delete Repo.rc.effAssign; }

function siteAdminTrim_(v) { return typeof v === 'string' ? v.trim() : v; }

/** 階・工区の配列を検査し、空白を除いた配列を返す(不正なら viol に積んで null) */
function siteAdminList_(v, path, min, max, viol) {
  if (!Array.isArray(v) || !v.every(function (x) { return typeof x === 'string'; })) { viol.push({ rule: 'FIELD_INVALID', path: path }); return null; }
  var a = v.map(function (x) { return x.trim(); });
  var bad = a.length < min || a.length > max || a.some(function (x) { return x.length < 1 || x.length > 10 || x.indexOf(',') >= 0; })
    || Util.uniq(a).length !== a.length;
  if (bad) { viol.push({ rule: 'FIELD_INVALID', path: path }); return null; }
  return a;
}

/** 現場の項目を検査し、送られたキーだけの保存値を返す(§5.4.8 共通の入力規則) */
function siteAdminFields_(p, viol) {
  var out = {};
  if (p.name !== undefined) {
    var n = siteAdminTrim_(p.name);
    if (typeof n !== 'string' || n.length < 1 || n.length > 40) viol.push({ rule: 'FIELD_INVALID', path: 'name' }); else out.name = n;
  }
  if (p.floors !== undefined) { var f = siteAdminList_(p.floors, 'floors', 1, 60, viol); if (f) out.floors = f; }
  if (p.zones !== undefined) { var z = siteAdminList_(p.zones, 'zones', 0, 20, viol); if (z) out.zones = z; }
  [['primeContractor', 40], ['address', 100]].forEach(function (km) {
    if (p[km[0]] === undefined) return;
    var x = siteAdminTrim_(p[km[0]]);
    if (typeof x !== 'string' || x.length > km[1]) viol.push({ rule: 'FIELD_INVALID', path: km[0] }); else out[km[0]] = x;
  });
  ['startDate', 'endDate'].forEach(function (k) {
    if (p[k] === undefined) return;
    var x = siteAdminTrim_(p[k]);
    if (typeof x !== 'string' || (x !== '' && !Util.isDate(x))) viol.push({ rule: 'FIELD_INVALID', path: k }); else out[k] = x;
  });
  return out;
}

function siteAdminCheckDates_(start, end, viol) {
  var already = viol.some(function (v) { return v.path === 'endDate'; });
  if (start && end && start > end && !already) viol.push({ rule: 'FIELD_INVALID', path: 'endDate' });
}

function siteAdminNameTaken_(name, exceptId) {
  return Repo.all('Sites').some(function (s) { return s.siteId !== exceptId && String(s.name || '').trim() === name; });
}

/** 役割整合(§2.3)+ disabled でない。存在しない人も false(存在を区別しない) */
function siteAdminCanTake_(userId, role) {
  var u = typeof userId === 'string' && userId ? Repo.get('Users', userId) : null;
  if (!u || u.status === 'disabled') return false;
  return assignmentRoleOk_({ assignRole: role }, u);
}

function adminSiteView_(s) {
  return {
    siteId: s.siteId, name: s.name, status: s.status, floors: Util.splitCsv(s.floors), zones: Util.splitCsv(s.zones),
    primeContractor: s.primeContractor || '', address: s.address || '', startDate: orNull_(s.startDate), endDate: orNull_(s.endDate),
    createdAt: s.createdAt, updatedAt: s.updatedAt
  };
}

function siteAdminRecords_(siteId) { return Repo.where('Records', 'siteId', siteId); }

/** 記録で使われている階・工区。並びは order(現場の並び)→ 残りは文字コード順 */
function siteAdminUsed_(recs, key, order) {
  var seen = {};
  recs.forEach(function (r) { var v = String(r[key] == null ? '' : r[key]).trim(); if (v) seen[v] = true; });
  var inOrder = order.filter(function (x) { return seen[x]; });
  var rest = Object.keys(seen).filter(function (x) { return order.indexOf(x) < 0; }).sort();
  return inOrder.concat(rest);
}

function siteAdminCounts_(recs) {
  var c = {};
  SITE_COUNT_KEYS_.forEach(function (k) { c[k] = 0; });
  recs.forEach(function (r) { if (Util.has(c, r.status)) c[r.status] += 1; });
  return c;
}

function siteAdminMustSite_(siteId) {
  Repo.fresh('Sites');
  var s = Repo.get('Sites', siteId);
  if (!s) throw new ApiError('NOT_FOUND', '現場が見つかりません');
  return s;
}

function siteAdminAssignsOf_(siteId) {
  return Repo.where('Assignments', 'siteId', siteId).slice().sort(function (a, b) {
    return SITE_ADMIN_ROLES_.indexOf(a.assignRole) - SITE_ADMIN_ROLES_.indexOf(b.assignRole);
  });
}

function siteAdminNewAssign_(siteId, userId, role, team, actor, now) {
  return {
    assignId: Util.newId('a'), siteId: siteId, userId: userId, assignRole: role, team: team || '',
    validFrom: Util.today(), validTo: '', active: true, createdBy: actor.userId, createdAt: now, updatedAt: now
  };
}

/* ===================== 参照 ===================== */

function act_adminGetSite(ctx) {
  siteAdminGuard_(ctx);
  var s = siteAdminMustSite_(ctx.params.siteId);
  var recs = siteAdminRecords_(s.siteId);
  return {
    site: adminSiteView_(s),
    usedFloors: siteAdminUsed_(recs, 'floor', Util.splitCsv(s.floors)),
    usedZones: siteAdminUsed_(recs, 'zone', Util.splitCsv(s.zones)),
    recordCounts: siteAdminCounts_(recs),
    assignments: siteAdminAssignsOf_(s.siteId).map(assignmentView_)
  };
}

/* ===================== 現場 ===================== */

function act_adminCreateSite(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params, actor = ctx.actor;
  Repo.fresh('Sites');
  var viol = [];
  var f = siteAdminFields_(p, viol);
  if (p.zones === undefined) f.zones = [];
  siteAdminCheckDates_(f.startDate, f.endDate, viol);
  if (f.name && siteAdminNameTaken_(f.name, null)) viol.push({ rule: 'SITE_NAME_DUPLICATE', path: 'name' });
  var subs = p.qaSubUserIds;
  var subsOk = Array.isArray(subs) && subs.length >= 1 && subs.every(function (x) { return typeof x === 'string'; }) && Util.uniq(subs).length === subs.length;
  if (!subsOk) {
    viol.push({ rule: 'FIELD_INVALID', path: 'qaSubUserIds' });
  } else {
    subs.forEach(function (u) { if (!siteAdminCanTake_(u, 'qa_sub')) viol.push({ rule: 'ASSIGN_ROLE_MISMATCH', path: 'qaSubUserIds', value: u }); });
    if (subs.indexOf(p.qaMainUserId) >= 0) viol.push({ rule: 'QA_MAIN_EQ_SUB', path: 'qaSubUserIds', value: p.qaMainUserId });
  }
  if (!siteAdminCanTake_(p.qaMainUserId, 'qa_main')) viol.push({ rule: 'ASSIGN_ROLE_MISMATCH', path: 'qaMainUserId', value: p.qaMainUserId });
  if (viol.length) throw violation_(viol);

  var now = Util.nowIso();
  var s = Repo.append('Sites', {
    siteId: Util.newId('s'), name: f.name, status: 'active', floors: f.floors.join(','), zones: f.zones.join(','),
    primeContractor: f.primeContractor || '', address: f.address || '', joinKey: Util.randomAlnum(16), driveFolderId: '',
    startDate: f.startDate || '', endDate: f.endDate || '', createdAt: now, updatedAt: now
  });
  var rows = [siteAdminNewAssign_(s.siteId, p.qaMainUserId, 'qa_main', '', actor, now)]
    .concat(subs.map(function (u) { return siteAdminNewAssign_(s.siteId, u, 'qa_sub', '', actor, now); }));
  var added = Repo.appendMany('Assignments', rows);
  siteAdminDropMemo_();
  Ev.add(ctx, 'site_created', {
    siteId: s.siteId,
    detail: { name: s.name, floors: f.floors, zones: f.zones, assignIds: added.map(function (a) { return a.assignId; }) }
  });
  return { site: adminSiteView_(s), assignments: added.map(assignmentView_) };
}

function act_adminUpdateSite(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params;
  var s = siteAdminMustSite_(p.siteId);
  var viol = [];
  var f = siteAdminFields_(p, viol);
  if (f.startDate !== undefined || f.endDate !== undefined) {
    var start = f.startDate !== undefined ? f.startDate : (s.startDate || '');
    var end = f.endDate !== undefined ? f.endDate : (s.endDate || '');
    siteAdminCheckDates_(start, end, viol);
  }
  if (f.name && siteAdminNameTaken_(f.name, s.siteId)) viol.push({ rule: 'SITE_NAME_DUPLICATE', path: 'name' });
  if (f.floors || f.zones) {
    var recs = siteAdminRecords_(s.siteId);
    [['floors', 'floor', 'FLOOR_IN_USE'], ['zones', 'zone', 'ZONE_IN_USE']].forEach(function (k) {
      if (!f[k[0]]) return;
      var cur = Util.splitCsv(s[k[0]]);
      var inUse = siteAdminUsed_(recs, k[1], cur);
      cur.forEach(function (v) {
        if (f[k[0]].indexOf(v) < 0 && inUse.indexOf(v) >= 0) viol.push({ rule: k[2], path: k[0], value: v });
      });
    });
  }
  if (viol.length) throw violation_(viol);

  var changed = {}, patch = {};
  Object.keys(f).forEach(function (k) {
    var before = (k === 'floors' || k === 'zones') ? Util.splitCsv(s[k]) : (s[k] == null ? '' : String(s[k]));
    if (JSON.stringify(before) === JSON.stringify(f[k])) return;
    changed[k] = { from: before, to: f[k] };
    patch[k] = Array.isArray(f[k]) ? f[k].join(',') : f[k];
  });
  if (Object.keys(changed).length) {
    patch.updatedAt = Util.nowIso();
    Repo.update('Sites', s, patch);
    Ev.add(ctx, 'site_updated', { siteId: s.siteId, detail: { changed: changed } });
  }
  return { site: adminSiteView_(s) };
}

function act_adminCloseSite(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params, actor = ctx.actor;
  var s = siteAdminMustSite_(p.siteId);
  if (s.status === 'closed') throw new ApiError('STATE_CONFLICT', '既に閉鎖されています', { status: 'closed' });
  var c = siteAdminCounts_(siteAdminRecords_(s.siteId));
  if (c.draft > 0 || c.submitted > 0 || c.fix > 0) {
    throw new ApiError('SITE_HAS_OPEN_RECORDS', '未完了の記録があります', { draft: c.draft, submitted: c.submitted, fix: c.fix });
  }
  if (c.qa_ok > 0 && p.acceptQaOk !== true) throw new ApiError('CLOSE_CONFIRM_REQUIRED', '元請待ちの記録があります', { qaOk: c.qa_ok });

  var now = Util.nowIso();
  Repo.update('Sites', s, { status: 'closed', updatedAt: now });
  var ended = Repo.where('Assignments', 'siteId', s.siteId).filter(function (a) { return a.active; });
  ended.forEach(function (a) { Repo.update('Assignments', a, { active: false, updatedAt: now }); });
  siteAdminDropMemo_();
  var rejected = Repo.where('Memberships', 'siteId', s.siteId).filter(function (m) { return m.status === 'pending'; });
  rejected.forEach(function (m) { Repo.update('Memberships', m, { status: 'rejected', decidedBy: actor.userId, decidedAt: now, note: '現場閉鎖' }); });
  Ev.add(ctx, 'site_closed', {
    siteId: s.siteId,
    detail: {
      assignIds: ended.map(function (a) { return a.assignId; }),
      membershipIds: rejected.map(function (m) { return m.membershipId; }), qaOk: c.qa_ok
    }
  });
  return { site: adminSiteView_(s), endedAssignments: ended.length, rejectedJoins: rejected.length };
}

function act_adminReopenSite(ctx) {
  siteAdminGuard_(ctx);
  var s = siteAdminMustSite_(ctx.params.siteId);
  if (s.status !== 'closed') throw new ApiError('STATE_CONFLICT', '閉鎖されていません', { status: s.status });
  var now = Util.nowIso();
  Repo.update('Sites', s, { status: 'active', updatedAt: now });
  // その現場の最も新しい site_closed の assignIds だけ戻す
  var last = null;
  Repo.where('Events', 'kind', 'site_closed').forEach(function (e) {
    if (e.siteId !== s.siteId) return;
    if (!last || Util.parseDt(e.at) >= Util.parseDt(last.at)) last = e;
  });
  var ids = last && last.detail && Array.isArray(last.detail.assignIds) ? last.detail.assignIds : [];
  var restored = [];
  ids.forEach(function (id) {
    var a = Repo.get('Assignments', id);
    if (a && a.siteId === s.siteId && !a.active) { Repo.update('Assignments', a, { active: true, updatedAt: now }); restored.push(a.assignId); }
  });
  siteAdminDropMemo_();
  Ev.add(ctx, 'site_reopened', { siteId: s.siteId, detail: { assignIds: restored } });
  return { site: adminSiteView_(s), restoredAssignments: restored.length };
}

/* ===================== 担当 ===================== */

function act_adminAddAssignment(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params, actor = ctx.actor;
  var s = siteAdminMustSite_(p.siteId);
  if (s.status === 'closed') throw new ApiError('SITE_CLOSED', '閉鎖された現場です');
  var role = p.assignRole;
  var isFm = role === 'foreman' || role === 'subforeman';
  var team = p.team === undefined || p.team === null ? '' : String(p.team).trim();
  var viol = [];
  if ((isFm && (team.length < 1 || team.length > 20)) || (!isFm && team !== '')) viol.push({ rule: 'FIELD_INVALID', path: 'team' });
  if (viol.length) throw violation_(viol);
  if (!siteAdminCanTake_(p.userId, role)) throw violation_([{ rule: 'ASSIGN_ROLE_MISMATCH', path: 'userId', value: p.userId }]);

  var eff = effectiveAssignments_().filter(function (a) { return a.siteId === s.siteId; });
  var mine = eff.filter(function (a) { return a.userId === p.userId; });
  var toEnd = [];
  if (role === 'qa_main') {
    // 主担当の交代: 今の主担当を外す。代行者を主担当に上げるときは、その代行者の行も外す
    if (mine.some(function (a) { return a.assignRole !== 'qa_sub'; })) throw violation_([{ rule: 'ASSIGN_DUPLICATE', path: 'userId', value: p.userId }]);
    var mySub = mine.filter(function (a) { return a.assignRole === 'qa_sub'; });
    var subsLeft = eff.filter(function (a) { return a.assignRole === 'qa_sub' && a.userId !== p.userId; });
    if (mySub.length && !subsLeft.length) throw violation_([{ rule: 'LAST_QA_SUB', path: 'userId', value: p.userId }]);
    toEnd = eff.filter(function (a) { return a.assignRole === 'qa_main'; }).concat(mySub);
  } else if (mine.length) {
    throw violation_([{ rule: 'ASSIGN_DUPLICATE', path: 'userId', value: p.userId }]);
  }

  var now = Util.nowIso();
  toEnd.forEach(function (a) { Repo.update('Assignments', a, { active: false, updatedAt: now }); });
  var row = Repo.append('Assignments', siteAdminNewAssign_(s.siteId, p.userId, role, isFm ? team : '', actor, now));
  siteAdminDropMemo_();
  Ev.add(ctx, 'assignment_added', {
    siteId: s.siteId,
    detail: { assignId: row.assignId, userId: p.userId, assignRole: role, team: row.team, ended: toEnd.map(function (a) { return a.assignId; }) }
  });
  return { assignment: assignmentView_(row), ended: toEnd.map(assignmentView_) };
}

function act_adminEndAssignment(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params, actor = ctx.actor;
  var a = Repo.get('Assignments', p.assignId);
  if (!a) throw new ApiError('NOT_FOUND', '担当が見つかりません');
  if (!a.active) throw new ApiError('STATE_CONFLICT', '既に終了しています');
  if (a.assignRole === 'qa_main' || a.assignRole === 'qa_sub') {
    var eff = effectiveAssignmentsFor_(a.siteId, a.assignRole);
    var isEff = eff.some(function (x) { return x.assignId === a.assignId; });
    if (isEff && eff.length <= 1) throw violation_([{ rule: a.assignRole === 'qa_main' ? 'LAST_QA_MAIN' : 'LAST_QA_SUB', path: 'assignId' }]);
  }
  var now = Util.nowIso();
  Repo.update('Assignments', a, { active: false, updatedAt: now });
  siteAdminDropMemo_();
  var m = null;
  if (a.assignRole === 'foreman' || a.assignRole === 'subforeman') {
    m = Repo.where('Memberships', 'siteId', a.siteId).filter(function (x) { return x.userId === a.userId && x.status === 'approved'; })[0] || null;
    if (m) Repo.update('Memberships', m, { status: 'revoked', decidedBy: actor.userId, decidedAt: now, note: '責任者が担当を終了' });
  }
  Ev.add(ctx, 'assignment_ended', {
    siteId: a.siteId,
    detail: { assignId: a.assignId, userId: a.userId, assignRole: a.assignRole, membershipId: m ? m.membershipId : null }
  });
  return { assignment: assignmentView_(a), membership: m ? membershipView_(actor, m) : null };
}

/* ===================== 人 ===================== */

function act_adminCreateUser(ctx) {
  siteAdminGuard_(ctx);
  var p = ctx.params;
  var viol = [];
  var name = siteAdminTrim_(p.name);
  if (typeof name !== 'string' || name.length < 1 || name.length > 20) viol.push({ rule: 'FIELD_INVALID', path: 'name' });
  [['nameKana', 40], ['company', 40], ['email', 100]].forEach(function (km) {
    if (p[km[0]] !== undefined && (typeof p[km[0]] !== 'string' || p[km[0]].trim().length > km[1])) viol.push({ rule: 'FIELD_INVALID', path: km[0] });
  });
  if (p.role !== 'foreman' && p.role !== 'qa') viol.push({ rule: 'FIELD_INVALID', path: 'role' });
  if (p.lang !== 'ja' && p.lang !== 'id') viol.push({ rule: 'FIELD_INVALID', path: 'lang' });
  if (typeof p.qaQualified !== 'boolean' || (p.role === 'foreman' && p.qaQualified === true)) viol.push({ rule: 'FIELD_INVALID', path: 'qaQualified' });
  if (viol.length) throw violation_(viol);

  var now = Util.nowIso();
  var u = Repo.append('Users', {
    userId: Util.newId('u'), name: name, nameKana: siteAdminTrim_(p.nameKana) || '', role: p.role, status: 'invited', lang: p.lang,
    email: siteAdminTrim_(p.email) || '', qaQualified: p.qaQualified, pinSalt: '', pinHash: '', failedCount: 0, lockedAt: '',
    lastLoginAt: '', note: '', createdAt: now, updatedAt: now, company: siteAdminTrim_(p.company) || ''
  });
  Ev.add(ctx, 'user_created', {
    detail: { userId: u.userId, name: u.name, role: u.role, company: u.company, lang: u.lang, qaQualified: !!u.qaQualified }
  });
  return {
    user: {
      userId: u.userId, name: u.name, company: u.company || '', role: u.role, status: u.status, lang: u.lang || 'ja',
      email: u.email ? u.email : null, qaQualified: !!u.qaQualified, failedCount: 0, lockedAt: null, lastLoginAt: null, devices: []
    }
  };
}
