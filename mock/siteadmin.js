// 責任者の現場管理(SPEC §5.4.8・§6.10。版1.13.0)の8 action。engine.js の C と、actions.js の H を受け取って登録する。
// 呼び出し時点で authorize(責任者のみ)は通過済み。ここでは 入力検証(全て列挙)→ 状態の検査 → 書き込み → Events の順。
// 検査で失敗したときは何も書かない(書き込みは全ての検査のあと)。
'use strict';

module.exports = function install(C, H) {
  const { fail, U, table, find, insert, ev, nowDt, user, siteRow, splitCsv } = C;
  const vfail = (violations) => fail('VALIDATION_FAILED', '入力が不正です', { violations });
  const str = (v) => (typeof v === 'string' ? v.trim() : v);
  const OPEN = ['draft', 'submitted', 'fix'];
  const COUNT_KEYS = ['draft', 'submitted', 'fix', 'qa_ok', 'approved'];
  const AR = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];

  // ---- 入力の規則(§5.4.8 共通) ----
  /** 階・工区の配列を検査して、空白を除いた配列を返す(不正なら viol に積んで null) */
  function normList(v, path, min, max, viol) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) { viol.push({ rule: 'FIELD_INVALID', path }); return null; }
    const a = v.map((x) => x.trim());
    const bad = a.length < min || a.length > max || a.some((x) => x.length < 1 || x.length > 10 || x.includes(','))
      || new Set(a).size !== a.length;
    if (bad) { viol.push({ rule: 'FIELD_INVALID', path }); return null; }
    return a;
  }
  /** 現場の項目を検査し、保存する値(送られたキーだけ)を返す */
  function siteFields(p, viol) {
    const out = {};
    if (p.name !== undefined) {
      const n = str(p.name);
      if (typeof n !== 'string' || n.length < 1 || n.length > 40) viol.push({ rule: 'FIELD_INVALID', path: 'name' }); else out.name = n;
    }
    if (p.floors !== undefined) { const a = normList(p.floors, 'floors', 1, 60, viol); if (a) out.floors = a; }
    if (p.zones !== undefined) { const a = normList(p.zones, 'zones', 0, 20, viol); if (a) out.zones = a; }
    for (const [k, max] of [['primeContractor', 40], ['address', 100]]) {
      if (p[k] === undefined) continue;
      const x = str(p[k]);
      if (typeof x !== 'string' || x.length > max) viol.push({ rule: 'FIELD_INVALID', path: k }); else out[k] = x;
    }
    for (const k of ['startDate', 'endDate']) {
      if (p[k] === undefined) continue;
      const x = str(p[k]);
      if (typeof x !== 'string' || (x !== '' && !U.isDateStr(x))) viol.push({ rule: 'FIELD_INVALID', path: k }); else out[k] = x;
    }
    return out;
  }
  function checkDates(start, end, viol) {
    if (start && end && start > end && !viol.some((v) => v.path === 'endDate')) viol.push({ rule: 'FIELD_INVALID', path: 'endDate' });
  }
  function nameTaken(name, exceptId) {
    return table('Sites').some((s) => s.siteId !== exceptId && String(s.name || '').trim() === name);
  }
  /** 役割整合(§2.3)+ disabled でない。存在しない人も false */
  function canTake(userId, role) {
    const u = typeof userId === 'string' ? user(userId) : null;
    if (!u || u.status === 'disabled') return false;
    if (role === 'qa_main') return u.role === 'qa' && u.qaQualified === true;
    if (role === 'qa_sub') return (u.role === 'qa' || u.role === 'lead') && u.qaQualified === true;
    return u.role === 'foreman';
  }

  // ---- ビュー ----
  function adminSiteView(s) {
    return {
      siteId: s.siteId, name: s.name, status: s.status, floors: splitCsv(s.floors), zones: splitCsv(s.zones),
      primeContractor: s.primeContractor || '', address: s.address || '', startDate: s.startDate || null, endDate: s.endDate || null,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  }
  const recordsOf = (siteId) => table('Records').filter((r) => r.siteId === siteId);
  function used(siteId, key, order) {
    const vals = new Set(recordsOf(siteId).map((r) => String(r[key] == null ? '' : r[key]).trim()).filter(Boolean));
    const inOrder = order.filter((x) => vals.has(x));
    const rest = [...vals].filter((x) => !order.includes(x)).sort();
    return inOrder.concat(rest);
  }
  function counts(siteId) {
    const c = {}; for (const k of COUNT_KEYS) c[k] = 0;
    for (const r of recordsOf(siteId)) if (c[r.status] !== undefined) c[r.status] += 1;
    return c;
  }
  const siteAssigns = (siteId) => table('Assignments').filter((a) => a.siteId === siteId)
    .sort((a, b) => AR.indexOf(a.assignRole) - AR.indexOf(b.assignRole));
  const mustSite = (id) => { const s = siteRow(id); if (!s) fail('NOT_FOUND', '現場が見つかりません'); return s; };
  const effOf = (siteId, role) => C.effAssigns(siteId).filter((a) => a.assignRole === role);
  function newAssign(siteId, userId, role, team, actor) {
    const n = nowDt();
    return insert('Assignments', { assignId: U.newId('a'), siteId, userId, assignRole: role, team: team || '', validFrom: C.today(), validTo: null, active: true, createdBy: actor.userId, createdAt: n, updatedAt: n });
  }

  // ===== adminGetSite(参照) =====
  H.adminGetSite = (rc) => {
    const s = mustSite(rc.params.siteId);
    return {
      site: adminSiteView(s), usedFloors: used(s.siteId, 'floor', splitCsv(s.floors)), usedZones: used(s.siteId, 'zone', splitCsv(s.zones)),
      recordCounts: counts(s.siteId), assignments: siteAssigns(s.siteId).map(C.assignmentView),
    };
  };

  // ===== adminCreateSite =====
  H.adminCreateSite = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const viol = [];
    const f = siteFields(p, viol);
    if (p.zones === undefined) f.zones = [];
    checkDates(f.startDate, f.endDate, viol);
    if (f.name && nameTaken(f.name)) viol.push({ rule: 'SITE_NAME_DUPLICATE', path: 'name' });
    const subs = p.qaSubUserIds;
    if (!Array.isArray(subs) || subs.length < 1 || !subs.every((x) => typeof x === 'string') || new Set(subs).size !== subs.length) {
      viol.push({ rule: 'FIELD_INVALID', path: 'qaSubUserIds' });
    } else {
      for (const u of subs) if (!canTake(u, 'qa_sub')) viol.push({ rule: 'ASSIGN_ROLE_MISMATCH', path: 'qaSubUserIds', value: u });
      if (subs.includes(p.qaMainUserId)) viol.push({ rule: 'QA_MAIN_EQ_SUB', path: 'qaSubUserIds', value: p.qaMainUserId });
    }
    if (!canTake(p.qaMainUserId, 'qa_main')) viol.push({ rule: 'ASSIGN_ROLE_MISMATCH', path: 'qaMainUserId', value: p.qaMainUserId });
    if (viol.length) vfail(viol);
    const n = nowDt();
    const s = insert('Sites', {
      siteId: U.newId('s'), name: f.name, status: 'active', floors: f.floors.join(','), zones: f.zones.join(','),
      primeContractor: f.primeContractor || '', address: f.address || '', joinKey: U.randStr(16), driveFolderId: '',
      startDate: f.startDate || null, endDate: f.endDate || null, createdAt: n, updatedAt: n,
    });
    const rows = [newAssign(s.siteId, p.qaMainUserId, 'qa_main', '', actor)].concat(subs.map((u) => newAssign(s.siteId, u, 'qa_sub', '', actor)));
    ev('site_created', { siteId: s.siteId, detail: { name: s.name, floors: f.floors, zones: f.zones, assignIds: rows.map((a) => a.assignId) } });
    return { site: adminSiteView(s), assignments: rows.map(C.assignmentView) };
  };

  // ===== adminUpdateSite =====
  H.adminUpdateSite = (rc) => {
    const p = rc.params;
    const s = mustSite(p.siteId);
    const viol = [];
    const f = siteFields(p, viol);
    const start = f.startDate !== undefined ? f.startDate : (s.startDate || '');
    const end = f.endDate !== undefined ? f.endDate : (s.endDate || '');
    if (f.startDate !== undefined || f.endDate !== undefined) checkDates(start, end, viol);
    if (f.name && nameTaken(f.name, s.siteId)) viol.push({ rule: 'SITE_NAME_DUPLICATE', path: 'name' });
    for (const [key, col, rule] of [['floors', 'floor', 'FLOOR_IN_USE'], ['zones', 'zone', 'ZONE_IN_USE']]) {
      if (!f[key]) continue;
      const cur = splitCsv(s[key]);
      const inUse = new Set(used(s.siteId, col, cur));
      for (const v of cur) if (!f[key].includes(v) && inUse.has(v)) viol.push({ rule, path: key, value: v });
    }
    if (viol.length) vfail(viol);
    const changed = {};
    for (const [k, v] of Object.entries(f)) {
      const before = k === 'floors' || k === 'zones' ? splitCsv(s[k]) : (s[k] == null ? '' : s[k]);
      if (JSON.stringify(before) !== JSON.stringify(v)) changed[k] = { from: before, to: v };
    }
    if (Object.keys(changed).length) {
      for (const k of Object.keys(changed)) {
        const v = changed[k].to;
        s[k] = Array.isArray(v) ? v.join(',') : ((k === 'startDate' || k === 'endDate') && v === '' ? null : v);
      }
      s.updatedAt = nowDt();
      ev('site_updated', { siteId: s.siteId, detail: { changed } });
    }
    return { site: adminSiteView(s) };
  };

  // ===== adminCloseSite =====
  H.adminCloseSite = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const s = mustSite(p.siteId);
    if (p.acceptQaOk !== undefined && typeof p.acceptQaOk !== 'boolean') vfail([{ rule: 'FIELD_INVALID', path: 'acceptQaOk' }]);
    if (s.status === 'closed') fail('STATE_CONFLICT', '既に閉鎖されています', { status: 'closed' });
    const c = counts(s.siteId);
    if (OPEN.some((k) => c[k] > 0)) fail('SITE_HAS_OPEN_RECORDS', '未完了の記録があります', { draft: c.draft, submitted: c.submitted, fix: c.fix });
    if (c.qa_ok > 0 && p.acceptQaOk !== true) fail('CLOSE_CONFIRM_REQUIRED', '元請待ちの記録があります', { qaOk: c.qa_ok });
    const n = nowDt();
    s.status = 'closed'; s.updatedAt = n;
    const ended = table('Assignments').filter((a) => a.siteId === s.siteId && a.active);
    for (const a of ended) { a.active = false; a.updatedAt = n; }
    const rejected = table('Memberships').filter((m) => m.siteId === s.siteId && m.status === 'pending');
    for (const m of rejected) { m.status = 'rejected'; m.decidedBy = actor.userId; m.decidedAt = n; m.note = '現場閉鎖'; }
    ev('site_closed', { siteId: s.siteId, detail: { assignIds: ended.map((a) => a.assignId), membershipIds: rejected.map((m) => m.membershipId), qaOk: c.qa_ok } });
    return { site: adminSiteView(s), endedAssignments: ended.length, rejectedJoins: rejected.length };
  };

  // ===== adminReopenSite =====
  H.adminReopenSite = (rc) => {
    const s = mustSite(rc.params.siteId);
    if (s.status !== 'closed') fail('STATE_CONFLICT', '閉鎖されていません', { status: s.status });
    const n = nowDt();
    s.status = 'active'; s.updatedAt = n;
    const last = table('Events').filter((e) => e.kind === 'site_closed' && e.siteId === s.siteId)
      .sort((a, b) => U.parseDt(b.at) - U.parseDt(a.at))[0];
    const ids = last && last.detail && Array.isArray(last.detail.assignIds) ? last.detail.assignIds : [];
    const restored = [];
    for (const id of ids) {
      const a = find('Assignments', id);
      if (a && a.siteId === s.siteId && !a.active) { a.active = true; a.updatedAt = n; restored.push(a.assignId); }
    }
    ev('site_reopened', { siteId: s.siteId, detail: { assignIds: restored } });
    return { site: adminSiteView(s), restoredAssignments: restored.length };
  };

  // ===== adminAddAssignment =====
  H.adminAddAssignment = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const s = mustSite(p.siteId);
    if (s.status === 'closed') fail('SITE_CLOSED', '閉鎖された現場です');
    const viol = [];
    const role = p.assignRole;
    if (!AR.includes(role)) viol.push({ rule: 'FIELD_INVALID', path: 'assignRole' });
    const team = p.team == null ? '' : str(p.team);
    const isFm = role === 'foreman' || role === 'subforeman';
    if (typeof team !== 'string' || (isFm && (team.length < 1 || team.length > 20)) || (!isFm && team !== '')) viol.push({ rule: 'FIELD_INVALID', path: 'team' });
    if (viol.length) vfail(viol);
    if (!canTake(p.userId, role)) vfail([{ rule: 'ASSIGN_ROLE_MISMATCH', path: 'userId', value: p.userId }]);
    const eff = C.effAssigns(s.siteId);
    const mine = eff.filter((a) => a.userId === p.userId);
    const toEnd = [];
    if (role === 'qa_main') {
      const others = mine.filter((a) => a.assignRole !== 'qa_sub');
      if (others.length) vfail([{ rule: 'ASSIGN_DUPLICATE', path: 'userId', value: p.userId }]);
      const mySub = mine.filter((a) => a.assignRole === 'qa_sub');
      const subsLeft = effOf(s.siteId, 'qa_sub').filter((a) => a.userId !== p.userId);
      if (mySub.length && subsLeft.length === 0) vfail([{ rule: 'LAST_QA_SUB', path: 'userId', value: p.userId }]);
      toEnd.push(...effOf(s.siteId, 'qa_main'), ...mySub);
    } else if (mine.length) {
      vfail([{ rule: 'ASSIGN_DUPLICATE', path: 'userId', value: p.userId }]);
    }
    const n = nowDt();
    for (const a of toEnd) { a.active = false; a.updatedAt = n; }
    const row = newAssign(s.siteId, p.userId, role, isFm ? team : '', actor);
    ev('assignment_added', { siteId: s.siteId, detail: { assignId: row.assignId, userId: p.userId, assignRole: role, team: row.team, ended: toEnd.map((a) => a.assignId) } });
    return { assignment: C.assignmentView(row), ended: toEnd.map(C.assignmentView) };
  };

  // ===== adminEndAssignment =====
  H.adminEndAssignment = (rc) => {
    const p = rc.params; const actor = rc.actor;
    const a = find('Assignments', p.assignId);
    if (!a) fail('NOT_FOUND', '担当が見つかりません');
    if (!a.active) fail('STATE_CONFLICT', '既に終了しています');
    if (a.assignRole === 'qa_main' || a.assignRole === 'qa_sub') {
      const eff = effOf(a.siteId, a.assignRole);
      if (eff.some((x) => x.assignId === a.assignId) && eff.length <= 1) vfail([{ rule: a.assignRole === 'qa_main' ? 'LAST_QA_MAIN' : 'LAST_QA_SUB', path: 'assignId' }]);
    }
    const n = nowDt();
    a.active = false; a.updatedAt = n;
    let m = null;
    if (a.assignRole === 'foreman' || a.assignRole === 'subforeman') {
      m = table('Memberships').find((x) => x.siteId === a.siteId && x.userId === a.userId && x.status === 'approved') || null;
      if (m) { m.status = 'revoked'; m.decidedBy = actor.userId; m.decidedAt = n; m.note = '責任者が担当を終了'; }
    }
    ev('assignment_ended', { siteId: a.siteId, detail: { assignId: a.assignId, userId: a.userId, assignRole: a.assignRole, membershipId: m ? m.membershipId : null } });
    return { assignment: C.assignmentView(a), membership: m ? C.membershipView(actor, m) : null };
  };

  // ===== adminCreateUser =====
  H.adminCreateUser = (rc) => {
    const p = rc.params;
    const viol = [];
    const name = str(p.name);
    if (typeof name !== 'string' || name.length < 1 || name.length > 20) viol.push({ rule: 'FIELD_INVALID', path: 'name' });
    for (const [k, max] of [['nameKana', 40], ['company', 40], ['email', 100]]) {
      if (p[k] !== undefined && (typeof p[k] !== 'string' || p[k].trim().length > max)) viol.push({ rule: 'FIELD_INVALID', path: k });
    }
    if (!['foreman', 'qa'].includes(p.role)) viol.push({ rule: 'FIELD_INVALID', path: 'role' });
    if (!['ja', 'id'].includes(p.lang)) viol.push({ rule: 'FIELD_INVALID', path: 'lang' });
    if (typeof p.qaQualified !== 'boolean' || (p.role === 'foreman' && p.qaQualified === true)) viol.push({ rule: 'FIELD_INVALID', path: 'qaQualified' });
    if (viol.length) vfail(viol);
    const n = nowDt();
    const u = insert('Users', {
      userId: U.newId('u'), name, nameKana: str(p.nameKana) || '', role: p.role, status: 'invited', lang: p.lang, email: str(p.email) || null,
      qaQualified: p.qaQualified, pinSalt: null, pinHash: null, failedCount: 0, lockedAt: null, lastLoginAt: null, note: '', createdAt: n, updatedAt: n, company: str(p.company) || '',
    });
    ev('user_created', { detail: { userId: u.userId, name: u.name, role: u.role, company: u.company, lang: u.lang, qaQualified: u.qaQualified } });
    return { user: H.adminListUsers().users.find((x) => x.userId === u.userId) };
  };

  return H;
};
