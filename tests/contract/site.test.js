// C-SITE-01〜10: 責任者の現場管理(SPEC §5.4.8・§6.10。版1.13.0)。mock・backend harness の両方
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const NEW_ACTIONS = ['adminGetSite', 'adminCreateSite', 'adminUpdateSite', 'adminCloseSite', 'adminReopenSite', 'adminAddAssignment', 'adminEndAssignment', 'adminCreateUser'];
const rules = (r) => ((r.error && r.error.data && r.error.data.violations) || []).map((v) => `${v.rule}:${v.path || ''}${v.value !== undefined ? '=' + v.value : ''}`).sort();

/** 責任者が新しい現場を作る(主担当 佐藤・代行者 鈴木) */
async function newSite(lead, over = {}) {
  const params = Object.assign({ name: 'D現場' + h.rand(4), floors: ['1F', '2F'], qaMainUserId: 'u_sato', qaSubUserIds: ['u_suzuki'] }, over);
  const r = await lead.call('adminCreateSite', params);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.data;
}
const bootSites = async (s) => (await s.ok('getBootstrap', {})).sites.map((x) => x.siteId);
const eventsKind = async (kind) => (await h.stateRows('Events')).filter((e) => e.kind === kind);
const assignOf = async (lead, siteId, userId, role) => (await lead.ok('adminGetSite', { siteId })).assignments.find((a) => a.userId === userId && a.assignRole === role && a.active);

describe('C-SITE 責任者の現場管理(版1.13.0)', () => {
  beforeEach(() => h.reset());

  it('C-SITE-01: 職長・QA は全て FORBIDDEN_ROLE。契約外キーは BAD_REQUEST、★の clientId 欠落も BAD_REQUEST', async () => {
    const tanaka = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const params = {
      adminGetSite: { siteId: 's_a' }, adminCreateSite: { name: 'X', floors: ['1F'], qaMainUserId: 'u_sato', qaSubUserIds: ['u_suzuki'] },
      adminUpdateSite: { siteId: 's_a' }, adminCloseSite: { siteId: 's_a' }, adminReopenSite: { siteId: 's_a' },
      adminAddAssignment: { siteId: 's_a', userId: 'u_tanaka', assignRole: 'foreman', team: 'T' }, adminEndAssignment: { assignId: 'a_seed01' },
      adminCreateUser: { name: 'X', role: 'foreman', lang: 'ja', qaQualified: false },
    };
    for (const s of [tanaka, sato]) {
      for (const a of NEW_ACTIONS) {
        const r = await s.call(a, params[a]);
        assert.equal(r.ok, false, a);
        assert.equal(r.error.code, 'FORBIDDEN_ROLE', `${s.userId} ${a}`);
      }
    }
    const bad = await lead.call('adminUpdateSite', { siteId: 's_a', status: 'closed' });
    assert.equal(bad.error.code, 'BAD_REQUEST');
    const noCid = await lead.call('adminReopenSite', { siteId: 's_a' }, { noClientId: true });
    assert.equal(noCid.error.code, 'BAD_REQUEST');
  });

  it('C-SITE-02: 作成すると active・担当2行。joinKey を返さない。すぐ getBootstrap に出て QR 参加できる。再送で増えない', async () => {
    const lead = await h.login('u_lead');
    const sato = await h.login('u_sato');
    const tanaka = await h.login('u_tanaka');
    const cid = h.newClientId();
    const p = { name: 'D現場', floors: ['1F', '2F'], qaMainUserId: 'u_sato', qaSubUserIds: ['u_suzuki'] };
    const r = await lead.call('adminCreateSite', p, { clientId: cid });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const site = r.data.site;
    assert.match(site.siteId, /^s_[a-z0-9]{12}$/);
    assert.equal(site.status, 'active');
    assert.deepEqual(site.floors, ['1F', '2F']);
    assert.deepEqual(site.zones, []);
    assert.ok(!('joinKey' in site) && !('driveFolderId' in site));
    assert.deepEqual(r.data.assignments.map((a) => `${a.assignRole}:${a.userId}`).sort(), ['qa_main:u_sato', 'qa_sub:u_suzuki']);
    assert.ok((await bootSites(lead)).includes(site.siteId));
    assert.ok((await bootSites(sato)).includes(site.siteId));
    const info = await lead.ok('adminGetJoinInfo', { siteId: site.siteId });
    const j = await tanaka.call('requestJoin', { siteId: site.siteId, joinKey: info.joinKey });
    assert.equal(j.ok, true, JSON.stringify(j.error));
    assert.equal(j.data.membership.status, 'pending');
    // 再送
    const again = await lead.call('adminCreateSite', p, { clientId: cid });
    assert.equal(again.ok, true);
    assert.equal(again.data.site.siteId, site.siteId);
    assert.equal((await h.stateRows('Sites')).filter((s) => s.name === 'D現場').length, 1);
    assert.equal((await h.stateRows('Assignments')).filter((a) => a.siteId === site.siteId).length, 2);
    const evs = await eventsKind('site_created');
    assert.equal(evs.length, 1);
    assert.ok(!JSON.stringify(evs[0].detail).includes(info.joinKey));
  });

  it('C-SITE-03: 作成の検証は全て列挙し、何も書かない', async () => {
    const lead = await h.login('u_lead');
    const before = (await h.stateRows('Sites')).length;
    const base = { name: 'E現場', floors: ['1F'], qaMainUserId: 'u_sato', qaSubUserIds: ['u_suzuki'] };
    let r = await lead.call('adminCreateSite', { ...base, qaSubUserIds: [] });
    assert.deepEqual(rules(r), ['FIELD_INVALID:qaSubUserIds']);
    r = await lead.call('adminCreateSite', { ...base, qaMainUserId: 'u_tanaka' });
    assert.deepEqual(rules(r), ['ASSIGN_ROLE_MISMATCH:qaMainUserId=u_tanaka']);
    r = await lead.call('adminCreateSite', { ...base, qaMainUserId: 'u_lead', qaSubUserIds: ['u_suzuki'] });
    assert.deepEqual(rules(r), ['ASSIGN_ROLE_MISMATCH:qaMainUserId=u_lead']);
    r = await lead.call('adminCreateSite', { ...base, qaSubUserIds: ['u_sato'] });
    assert.deepEqual(rules(r), ['QA_MAIN_EQ_SUB:qaSubUserIds=u_sato']);
    r = await lead.call('adminCreateSite', { ...base, name: ' A現場(仮) ' });
    assert.deepEqual(rules(r), ['SITE_NAME_DUPLICATE:name']);
    for (const floors of [[], ['12345678901'], ['1,2'], ['1F', '1F']]) {
      r = await lead.call('adminCreateSite', { ...base, floors });
      assert.deepEqual(rules(r), ['FIELD_INVALID:floors'], JSON.stringify(floors));
    }
    r = await lead.call('adminCreateSite', { ...base, startDate: '2026-12-01', endDate: '2026-11-01' });
    assert.deepEqual(rules(r), ['FIELD_INVALID:endDate']);
    // 全て列挙
    r = await lead.call('adminCreateSite', { name: ' A現場(仮) ', floors: [], qaMainUserId: 'u_tanaka', qaSubUserIds: ['u_tanaka'] });
    assert.deepEqual(rules(r), ['ASSIGN_ROLE_MISMATCH:qaMainUserId=u_tanaka', 'ASSIGN_ROLE_MISMATCH:qaSubUserIds=u_tanaka', 'FIELD_INVALID:floors', 'QA_MAIN_EQ_SUB:qaSubUserIds=u_tanaka', 'SITE_NAME_DUPLICATE:name']);
    assert.equal((await h.stateRows('Sites')).length, before);
  });

  it('C-SITE-04: 階・工区は足す・並べ替え・未使用を外すだけ。使用中は外せない(名前の変更も)', async () => {
    const lead = await h.login('u_lead');
    const { site } = await newSite(lead, { floors: ['1F', '2F'], zones: ['東', '西'] });
    await lead.ok('adminAddAssignment', { siteId: site.siteId, userId: 'u_tanaka', assignRole: 'foreman', team: '田中班' });
    const tanaka = await h.login('u_tanaka');
    const c = await h.createRecordFor(tanaka, { siteId: site.siteId, floor: '2F', zone: '東' });
    assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
    const g = await lead.ok('adminGetSite', { siteId: site.siteId });
    assert.deepEqual(g.usedFloors, ['2F']);
    assert.deepEqual(g.usedZones, ['東']);
    assert.deepEqual(g.recordCounts, { draft: 1, submitted: 0, fix: 0, qa_ok: 0, approved: 0 });
    let r = await lead.call('adminUpdateSite', { siteId: site.siteId, floors: ['1F'] });
    assert.deepEqual(rules(r), ['FLOOR_IN_USE:floors=2F']);
    r = await lead.call('adminUpdateSite', { siteId: site.siteId, floors: ['1F', '2階'], zones: ['西'] });
    assert.deepEqual(rules(r), ['FLOOR_IN_USE:floors=2F', 'ZONE_IN_USE:zones=東']);
    r = await lead.call('adminUpdateSite', { siteId: site.siteId, floors: ['2F', '1F', '3F'], zones: ['東'] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data.site.floors, ['2F', '1F', '3F']);
    assert.deepEqual(r.data.site.zones, ['東']);
    const bs = (await tanaka.ok('getBootstrap', {})).sites.find((s) => s.siteId === site.siteId);
    assert.deepEqual(bs.floors, ['2F', '1F', '3F']);
    r = await lead.call('adminUpdateSite', { siteId: site.siteId, name: 'B現場(仮)' });
    assert.deepEqual(rules(r), ['SITE_NAME_DUPLICATE:name']);
    r = await lead.call('adminUpdateSite', { siteId: site.siteId, name: site.name, primeContractor: '○○建設' });
    assert.equal(r.ok, true);
    // 何も変えない送信: updatedAt が変わらず Events も増えない
    const ev0 = (await eventsKind('site_updated')).length;
    const u0 = r.data.site.updatedAt;
    await h.mock('clock', { advanceMin: 1 });
    const same = await lead.ok('adminUpdateSite', { siteId: site.siteId, name: site.name, floors: ['2F', '1F', '3F'] });
    assert.equal(same.site.updatedAt, u0);
    assert.equal((await eventsKind('site_updated')).length, ev0);
  });

  it('C-SITE-05: 閉鎖は未完了があると不可、元請待ちは確認つきで可。担当を無効・申請中を却下。閉鎖中は作成・参加不可、責任者は元請サインできる', async () => {
    const lead = await h.login('u_lead');
    const tanaka = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const sugiant = await h.login('u_sugiant');
    const { site } = await newSite(lead);
    const sid = site.siteId;
    await lead.ok('adminAddAssignment', { siteId: sid, userId: 'u_tanaka', assignRole: 'foreman', team: '田中班' });
    const c = await h.createRecordFor(tanaka, { siteId: sid });
    assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
    let r = await lead.call('adminCloseSite', { siteId: sid });
    assert.equal(r.error.code, 'SITE_HAS_OPEN_RECORDS');
    assert.deepEqual(r.error.data, { draft: 1, submitted: 0, fix: 0 });
    await h.advanceToQaOk(tanaka, sato, c.recordId);
    r = await lead.call('adminCloseSite', { siteId: sid });
    assert.equal(r.error.code, 'CLOSE_CONFIRM_REQUIRED');
    assert.deepEqual(r.error.data, { qaOk: 1 });
    const info = await lead.ok('adminGetJoinInfo', { siteId: sid });
    await sugiant.ok('requestJoin', { siteId: sid, joinKey: info.joinKey });
    r = await lead.call('adminCloseSite', { siteId: sid, acceptQaOk: true });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.site.status, 'closed');
    assert.equal(r.data.endedAssignments, 3);
    assert.equal(r.data.rejectedJoins, 1);
    const asg = (await h.stateRows('Assignments')).filter((a) => a.siteId === sid);
    assert.ok(asg.every((a) => a.active === false));
    const mem = (await h.stateRows('Memberships')).find((m) => m.siteId === sid && m.userId === 'u_sugiant');
    assert.equal(mem.status, 'rejected');
    assert.equal(mem.note, '現場閉鎖');
    // 閉鎖中
    const c2 = await h.createRecordFor(tanaka, { siteId: sid });
    assert.equal(c2.res.ok, false);
    assert.ok(['SITE_CLOSED', 'FORBIDDEN_SITE'].includes(c2.res.error.code), c2.res.error.code);
    const lc = await h.createRecordFor(lead, { siteId: sid });
    assert.equal(lc.res.error.code, 'SITE_CLOSED');
    const j = await sugiant.call('requestJoin', { siteId: sid, joinKey: info.joinKey });
    assert.equal(j.error.code, 'SITE_CLOSED');
    assert.ok(!(await bootSites(sato)).includes(sid));
    assert.ok(!(await bootSites(tanaka)).includes(sid));
    assert.ok(!(await tanaka.ok('listRecords', {})).records.some((x) => x.siteId === sid));
    assert.ok((await bootSites(lead)).includes(sid));
    const g = await lead.call('generateReport', { recordId: c.recordId });
    assert.equal(g.ok, true, JSON.stringify(g.error));
    await h.primeSign(lead, c.recordId);
    r = await lead.call('adminCloseSite', { siteId: sid, acceptQaOk: true });
    assert.equal(r.error.code, 'STATE_CONFLICT');
    assert.deepEqual(r.error.data, { status: 'closed' });
  });

  it('C-SITE-06: 再開は閉鎖で無効にした担当だけ戻す。却下した申請は戻さない。直接 closed の現場は 0 件', async () => {
    const lead = await h.login('u_lead');
    const sato = await h.login('u_sato');
    const { site } = await newSite(lead);
    const sid = site.siteId;
    const fm = await lead.ok('adminAddAssignment', { siteId: sid, userId: 'u_tanaka', assignRole: 'foreman', team: '田中班' });
    await lead.ok('adminEndAssignment', { assignId: fm.assignment.assignId }); // 閉鎖の前から無効
    await lead.ok('adminCloseSite', { siteId: sid });
    assert.ok(!(await bootSites(sato)).includes(sid));
    const r = await lead.call('adminReopenSite', { siteId: sid });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.site.status, 'active');
    assert.equal(r.data.restoredAssignments, 2);
    const rows = (await h.stateRows('Assignments')).filter((a) => a.siteId === sid);
    assert.equal(rows.find((a) => a.assignId === fm.assignment.assignId).active, false);
    assert.equal(rows.filter((a) => a.active).length, 2);
    assert.ok((await bootSites(sato)).includes(sid));
    const again = await lead.call('adminReopenSite', { siteId: sid });
    assert.equal(again.error.code, 'STATE_CONFLICT');
    assert.equal((await eventsKind('site_reopened')).length, 1);
    // シートで直接 closed にした現場
    await h.mock('patch', { sheet: 'Sites', key: 's_b', set: { status: 'closed' } });
    const rb = await lead.call('adminReopenSite', { siteId: 's_b' });
    assert.equal(rb.ok, true, JSON.stringify(rb.error));
    assert.equal(rb.data.restoredAssignments, 0);
  });

  it('C-SITE-07: 担当の追加(班必須・役割整合・重複・閉鎖中)と主担当の交代', async () => {
    const lead = await h.login('u_lead');
    let r = await lead.call('adminAddAssignment', { siteId: 's_c', userId: 'u_tanaka', assignRole: 'foreman' });
    assert.deepEqual(rules(r), ['FIELD_INVALID:team']);
    r = await lead.call('adminAddAssignment', { siteId: 's_c', userId: 'u_sato', assignRole: 'foreman', team: 'X' });
    assert.deepEqual(rules(r), ['ASSIGN_ROLE_MISMATCH:userId=u_sato']);
    r = await lead.call('adminAddAssignment', { siteId: 's_c', userId: 'u_sato', assignRole: 'qa_sub', team: 'X' });
    assert.deepEqual(rules(r), ['FIELD_INVALID:team']);
    const memBefore = (await h.stateRows('Memberships')).length;
    r = await lead.call('adminAddAssignment', { siteId: 's_c', userId: 'u_tanaka', assignRole: 'foreman', team: '田中班' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data.ended, []);
    assert.equal((await h.stateRows('Memberships')).length, memBefore);
    const tanaka = await h.login('u_tanaka');
    assert.ok((await bootSites(tanaka)).includes('s_c'));
    const c = await h.createRecordFor(tanaka, { siteId: 's_c', floor: '1F', zone: '西' });
    assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
    r = await lead.call('adminAddAssignment', { siteId: 's_c', userId: 'u_tanaka', assignRole: 'subforeman', team: '田中班' });
    assert.deepEqual(rules(r), ['ASSIGN_DUPLICATE:userId=u_tanaka']);
    // 閉鎖中
    const { site } = await newSite(lead);
    await lead.ok('adminCloseSite', { siteId: site.siteId });
    r = await lead.call('adminAddAssignment', { siteId: site.siteId, userId: 'u_tanaka', assignRole: 'foreman', team: 'T' });
    assert.equal(r.error.code, 'SITE_CLOSED');
    // 主担当の交代: s_a(主 佐藤・代行 鈴木だけ)
    r = await lead.call('adminAddAssignment', { siteId: 's_a', userId: 'u_suzuki', assignRole: 'qa_main' });
    assert.deepEqual(rules(r), ['LAST_QA_SUB:userId=u_suzuki']);
    await lead.ok('adminAddAssignment', { siteId: 's_a', userId: 'u_lead', assignRole: 'qa_sub' });
    r = await lead.call('adminAddAssignment', { siteId: 's_a', userId: 'u_suzuki', assignRole: 'qa_main' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data.ended.map((a) => `${a.assignRole}:${a.userId}`).sort(), ['qa_main:u_sato', 'qa_sub:u_suzuki']);
    assert.ok(r.data.ended.every((a) => a.active === false));
    const probs = (await lead.ok('adminValidateRoster', {})).problems.filter((p) => p.siteId === 's_a' && p.level === 'error');
    assert.deepEqual(probs, []);
  });

  it('C-SITE-08: 担当の終了(主担当・最後の代行者は不可)。職長は参加も取り消され、QRから申請し直せる', async () => {
    const lead = await h.login('u_lead');
    const tanaka = await h.login('u_tanaka');
    const main = await assignOf(lead, 's_a', 'u_sato', 'qa_main');
    const sub = await assignOf(lead, 's_a', 'u_suzuki', 'qa_sub');
    let r = await lead.call('adminEndAssignment', { assignId: main.assignId });
    assert.deepEqual(rules(r), ['LAST_QA_MAIN:assignId']);
    r = await lead.call('adminEndAssignment', { assignId: sub.assignId });
    assert.deepEqual(rules(r), ['LAST_QA_SUB:assignId']);
    const fm = await assignOf(lead, 's_a', 'u_tanaka', 'foreman');
    r = await lead.call('adminEndAssignment', { assignId: fm.assignId });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.assignment.active, false);
    assert.equal(r.data.membership.status, 'revoked');
    assert.ok(!(await bootSites(tanaka)).includes('s_a'));
    const info = await lead.ok('adminGetJoinInfo', { siteId: 's_a' });
    const j = await tanaka.call('requestJoin', { siteId: 's_a', joinKey: info.joinKey });
    assert.equal(j.ok, true, JSON.stringify(j.error));
    assert.equal(j.data.membership.status, 'pending');
    r = await lead.call('adminEndAssignment', { assignId: fm.assignId });
    assert.equal(r.error.code, 'STATE_CONFLICT');
    r = await lead.call('adminEndAssignment', { assignId: 'a_nothere0000' });
    assert.equal(r.error.code, 'NOT_FOUND');
  });

  it('C-SITE-09: 新しい人は invited で作り、続けて招待コードで登録できる。責任者・職長の代行資格は作れない', async () => {
    const lead = await h.login('u_lead');
    const r = await lead.call('adminCreateUser', { name: '高橋', nameKana: 'たかはし', role: 'qa', company: '株式会社RCCREATE', lang: 'ja', qaQualified: true });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const u = r.data.user;
    assert.match(u.userId, /^u_[a-z0-9]{12}$/);
    assert.equal(u.status, 'invited');
    assert.deepEqual(u.devices, []);
    assert.ok(!('pinHash' in u) && !('pinSalt' in u));
    assert.ok((await lead.ok('adminListUsers', {})).users.some((x) => x.userId === u.userId));
    const inv = await lead.ok('adminIssueInvite', { userId: u.userId, purpose: 'first' });
    const look = await h.call('lookupInvite', { inviteCode: inv.code });
    assert.equal(look.data.name, '高橋');
    const reg = await h.call('registerDevice', { inviteCode: inv.code, pin: '5555' });
    assert.equal(reg.ok, true, JSON.stringify(reg.error));
    assert.equal(reg.data.user.status, 'active');
    let x = await lead.call('adminCreateUser', { name: '誰か', role: 'lead', lang: 'ja', qaQualified: true });
    assert.deepEqual(rules(x), ['FIELD_INVALID:role']);
    x = await lead.call('adminCreateUser', { name: '誰か', role: 'foreman', lang: 'ja', qaQualified: true });
    assert.deepEqual(rules(x), ['FIELD_INVALID:qaQualified']);
    x = await lead.call('adminCreateUser', { name: 'あ'.repeat(21), role: 'foreman', lang: 'ja', qaQualified: false });
    assert.deepEqual(rules(x), ['FIELD_INVALID:name']);
    x = await lead.call('adminCreateUser', { name: '高橋', role: 'foreman', lang: 'id', qaQualified: false });
    assert.equal(x.ok, true, '同じ氏名でも作れる');
    const add = await lead.call('adminAddAssignment', { siteId: 's_c', userId: u.userId, assignRole: 'qa_sub' });
    assert.equal(add.ok, true, JSON.stringify(add.error));
    const idem = JSON.stringify(await h.stateRows('Idem'));
    const evs = JSON.stringify(await h.stateRows('Events'));
    assert.ok(!idem.includes(inv.code) && !evs.includes(inv.code), '招待コード平文を残さない');
  });

  it('C-SITE-10: 書き込みごとに Events を1件。同じ clientId の再送で増えず、内容違いは IDEMPOTENCY_CONFLICT', async () => {
    const lead = await h.login('u_lead');
    const cid = h.newClientId();
    const { site } = await newSite(lead);
    const steps = [
      ['adminUpdateSite', { siteId: site.siteId, address: '東京都' }, 'site_updated'],
      ['adminAddAssignment', { siteId: site.siteId, userId: 'u_tanaka', assignRole: 'foreman', team: 'T' }, 'assignment_added'],
      ['adminCreateUser', { name: '新人', role: 'foreman', lang: 'ja', qaQualified: false }, 'user_created'],
      ['adminCloseSite', { siteId: site.siteId }, 'site_closed'],
      ['adminReopenSite', { siteId: site.siteId }, 'site_reopened'],
    ];
    for (const [a, p, kind] of steps) {
      const c = h.newClientId();
      const r1 = await lead.call(a, p, { clientId: c });
      assert.equal(r1.ok, true, `${a} ${JSON.stringify(r1.error)}`);
      const r2 = await lead.call(a, p, { clientId: c });
      assert.equal(r2.ok, true);
      assert.equal((await eventsKind(kind)).length, 1, kind);
    }
    const fm = await assignOf(lead, site.siteId, 'u_tanaka', 'foreman');
    const ce = h.newClientId();
    await lead.ok('adminEndAssignment', { assignId: fm.assignId }, { clientId: ce });
    await lead.ok('adminEndAssignment', { assignId: fm.assignId }, { clientId: ce });
    assert.equal((await eventsKind('assignment_ended')).length, 1);
    await lead.ok('adminUpdateSite', { siteId: site.siteId, address: 'A' }, { clientId: cid });
    const conflict = await lead.call('adminUpdateSite', { siteId: site.siteId, address: 'B' }, { clientId: cid });
    assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  });
});
