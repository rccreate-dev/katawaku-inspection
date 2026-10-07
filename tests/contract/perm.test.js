// C-PERM-01〜10: 権限
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const SEED = { a1: 'r_seeda10000000000', a2: 'r_seeda20000000000', a3: 'r_seeda30000000000', b1: 'r_seedb10000000000', b2: 'r_seedb20000000000', c1: 'r_seedc10000000000', c2: 'r_seedc20000000000' };
const MASKED_KEYS = ['actions', 'floor', 'lot', 'masked', 'recordId', 'siteId', 'stage', 'status', 'team', 'updatedAt', 'version', 'zone'];

describe('C-PERM 権限', () => {
  beforeEach(() => h.reset());

  it('C-PERM-01: 職長は他現場を一覧・詳細で見られない', async () => {
    const t = await h.login('u_tanaka');
    const l = await t.ok('listRecords', {});
    const sites = new Set(l.records.map((r) => r.siteId));
    assert.deepEqual([...sites].sort(), ['s_a', 's_b']);
    assert.equal((await t.call('listRecords', { siteId: 's_c' })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await t.call('getRecord', { recordId: SEED.c1 })).error.code, 'FORBIDDEN_SITE');
    const b = await t.ok('getBootstrap', {});
    assert.deepEqual(b.sites.map((s) => s.siteId).sort(), ['s_a', 's_b']);
  });

  it('C-PERM-02: 他班の記録は masked・詳細不可・写真不可・同スロット作成は ALREADY_EXISTS(mine:false)', async () => {
    const t = await h.login('u_tanaka');
    const sg = await h.login('u_sugiant');
    const l = await t.ok('listRecords', { siteId: 's_b' });
    const m = l.records.find((r) => r.recordId === SEED.b2);
    assert.equal(m.masked, true);
    assert.deepEqual(Object.keys(m).sort(), MASKED_KEYS);
    assert.deepEqual(m.actions, []);
    assert.equal((await t.call('getRecord', { recordId: SEED.b2 })).error.code, 'FORBIDDEN_TEAM');
    // スギアントが撮った写真は田中から見えない
    const up = await h.uploadPhoto(sg, { recordId: SEED.b2, itemId: 'i2', side: 'self' });
    assert.equal(up.ok, true, JSON.stringify(up.error));
    const pid = up.data.photo.photoId;
    const own = await sg.ok('getPhotoThumbs', { photoIds: [pid] });
    assert.equal(own.photos.length, 1);
    const other = await t.ok('getPhotoThumbs', { photoIds: [pid] });
    assert.deepEqual(other.missing, [pid]);
    assert.equal(other.photos.length, 0);
    assert.equal((await t.call('getPhoto', { photoId: pid })).error.code, 'NOT_FOUND');
    const c = await h.createRecordFor(t, { siteId: 's_b', floor: '2F', lot: 'L1' });
    assert.equal(c.res.error.code, 'ALREADY_EXISTS');
    assert.equal(c.res.error.data.recordId, SEED.b2);
    assert.equal(c.res.error.data.mine, false);
  });

  it('C-PERM-03: 担当外QAは claim/判定/元請サイン/PDF 不可、責任者は最終代行できる', async () => {
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    assert.equal((await qa.call('claimReview', { recordId: SEED.c2, round: 1 })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await qa.call('submitVerdict', { recordId: SEED.c2, round: 1, verdict: 'minor', comment: 'x' })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await qa.call('recordPrimeSign', { recordId: SEED.c1, signerName: '山田', method: 'paper' }, { pin: qa.pin })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await qa.call('generateReport', { recordId: SEED.c1 })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await qa.call('getRecord', { recordId: SEED.c1 })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await qa.call('listRecords', { siteId: 's_c' })).error.code, 'FORBIDDEN_SITE');
    const c = await lead.call('claimReview', { recordId: SEED.c2, round: 1 });
    assert.equal(c.ok, true, JSON.stringify(c.error));
    assert.equal(c.data.record.claimedBy, 'u_lead');
  });

  it('C-PERM-04: 役割違いの action は FORBIDDEN_ROLE', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lead = await h.login('u_lead');
    const rid = SEED.a2;
    for (const [action, params, opts] of [
      ['claimReview', { recordId: rid, round: 1 }, {}],
      ['submitVerdict', { recordId: rid, round: 1, verdict: 'ok' }, { pin: '1111' }],
      ['recordPrimeSign', { recordId: rid, signerName: 'x', method: 'paper' }, { pin: '1111' }],
      ['generateReport', { recordId: rid }, {}],
      ['listAssignments', {}, {}],
    ]) assert.equal((await t.call(action, params, opts)).error.code, 'FORBIDDEN_ROLE', `職長の ${action}`);
    for (const s of [qa, lead]) {
      assert.equal((await s.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '1F', lot: 'Q1', stage: 'pre_pour' })).error.code, 'FORBIDDEN_ROLE');
      assert.equal((await s.call('saveDraft', { recordId: SEED.a3, items: [] })).error.code, 'FORBIDDEN_ROLE');
      assert.equal((await s.call('submitRecord', { recordId: SEED.a3, round: 1 }, { pin: s.pin })).error.code, 'FORBIDDEN_ROLE');
      assert.equal((await s.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' })).error.code, 'FORBIDDEN_ROLE');
    }
  });

  it('C-PERM-05: 提出後は職長の編集・写真・コメントが RECORD_LOCKED、fix では可', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t);
    const before = await h.getRecord(t, recordId);
    const photoId = before.items.find((i) => i.itemId === 'i2').self.photos[0].photoId;
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    const probe = async (label) => {
      assert.equal((await t.call('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ng' }] })).error.code, 'RECORD_LOCKED', `${label}: saveDraft`);
      assert.equal((await h.uploadPhoto(t, { recordId, itemId: 'i1', side: 'self' })).error.code, 'RECORD_LOCKED', `${label}: 写真`);
      assert.equal((await t.call('addNote', { recordId, text: 'メモ' })).error.code, 'RECORD_LOCKED', `${label}: addNote`);
      assert.equal((await t.call('deletePhoto', { photoId })).error.code, 'RECORD_LOCKED', `${label}: deletePhoto`);
      const rec = await h.getRecord(t, recordId);
      assert.ok(!rec.actions.includes('saveDraft'));
    };
    await probe('submitted');
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
    await probe('qa_ok');
    await qa.ok('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin });
    await probe('approved');

    // fix では全て成功
    const { recordId: r2 } = await h.makeSubmitted(t);
    const d2 = await h.getRecord(t, r2);
    const p2 = d2.items.find((i) => i.itemId === 'i2').self.photos[0].photoId;
    await qa.ok('claimReview', { recordId: r2, round: 1 });
    await h.fillQa(qa, r2, { i10: { result: 'ng', severity: 'minor', note: '緊結が甘い' } }, { comment: 'やり直し' });
    await qa.ok('submitVerdict', { recordId: r2, round: 1, verdict: 'minor' });
    assert.equal((await t.call('saveDraft', { recordId: r2, items: [{ itemId: 'i10', result: 'ok', note: '是正した' }] })).ok, true);
    assert.equal((await h.uploadPhoto(t, { recordId: r2, itemId: 'i10', side: 'self' })).ok, true);
    assert.equal((await t.call('addNote', { recordId: r2, text: '是正しました' })).ok, true);
    assert.equal((await t.call('deletePhoto', { photoId: p2 })).ok, true);
  });

  it('C-PERM-06: 職長コメントは管理者操作で消えない・上書きされない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.createRecordFor(t, {});
    await t.ok('saveDraft', { recordId, items: h.okPatches({ i9: { result: 'ng', note: '控えが1箇所不足' }, i1: { note: '最新版を確認' } }) });
    for (const id of h.KEY_ITEMS) await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    const noteOf = (rec, itemId) => rec.items.find((i) => i.itemId === itemId).self.note;
    const base = await h.getRecord(qa, recordId);
    assert.equal(noteOf(base, 'i9'), '控えが1箇所不足');
    const baseNotes = new Map(base.notes.map((n) => [n.noteId, n.text]));
    assert.ok(baseNotes.size >= 2, '提出時に職長コメントがNotesに残る');

    await qa.ok('claimReview', { recordId, round: 1 });
    // 職長の列に相当するキーは送れない
    for (const key of ['selfResult', 'foremanNote', 'selfValues', 'selfNote']) {
      const r = await qa.call('saveQaDraft', { recordId, items: [{ itemId: 'i9', [key]: 'x' }] });
      assert.equal(r.error.code, 'VALIDATION_FAILED', key);
      assert.ok(r.error.data.violations.some((v) => v.rule === 'FIELD_INVALID'));
    }
    await h.fillQa(qa, recordId, { i9: { result: 'ng', severity: 'minor', note: '控え追加を指示' } }, { comment: '控えを追加してください' });
    const during = await h.getRecord(qa, recordId);
    assert.equal(noteOf(during, 'i9'), '控えが1箇所不足', 'QA入力後も職長コメントは不変');
    assert.equal(during.items.find((i) => i.itemId === 'i9').qa.note, '控え追加を指示');
    const m = await qa.ok('addNote', { recordId, itemId: 'i9', text: '管理者メモ' });
    assert.equal(m.note.kind, 'manager');
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });

    const afterVerdict = await h.getRecord(t, recordId);
    assert.equal(noteOf(afterVerdict, 'i9'), '控えが1箇所不足');
    for (const [id, text] of baseNotes) assert.equal(afterVerdict.notes.find((n) => n.noteId === id).text, text);
    assert.ok(afterVerdict.notes.length > baseNotes.size, '件数は増える');
    assert.ok(afterVerdict.notes.some((n) => n.kind === 'manager' && n.itemId === 'i9'));
    assert.ok(afterVerdict.notes.some((n) => n.kind === 'foreman'));

    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i9', result: 'ok', note: '控えを追加した' }] });
    await h.uploadPhoto(t, { recordId, itemId: 'i9', side: 'self' });
    const re = await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(re.record.round, 2);
    const after = await h.getRecord(qa, recordId);
    assert.ok(after.items.every((i) => i.qa.result === null && i.qa.note === ''), '再提出でQA列は空');
    for (const [id, text] of afterVerdict.notes.map((n) => [n.noteId, n.text])) assert.equal(after.notes.find((n) => n.noteId === id).text, text, '既存Notesは不変');
    assert.ok(after.notes.length >= afterVerdict.notes.length);
    assert.ok(after.events.some((e) => e.kind === 'verdict_minor'), '前回の判定イベントが残る');
    assert.ok(after.events.some((e) => e.kind === 'resubmitted'));
  });

  it('C-PERM-07: admin* は職長・QAで FORBIDDEN_ROLE', async () => {
    const calls = [['adminListUsers', {}], ['adminIssueInvite', { userId: 'u_tanaka', purpose: 'pinReset' }], ['adminUnlockUser', { userId: 'u_tanaka' }], ['adminSetUserStatus', { userId: 'u_tanaka', status: 'disabled' }], ['adminRevokeDevice', { deviceId: 'd_none' }], ['adminSetAbsence', { userId: 'u_sato', dateFrom: '2026-10-07', dateTo: '2026-10-07' }], ['adminCancelAbsence', { absenceId: 'b_none' }], ['adminGetJoinInfo', { siteId: 's_a' }], ['adminRotateJoinKey', { siteId: 's_a' }], ['adminValidateRoster', {}]];
    for (const u of ['u_tanaka', 'u_sato']) {
      const s = await h.login(u);
      for (const [a, p] of calls) assert.equal((await s.call(a, p)).error.code, 'FORBIDDEN_ROLE', `${u}:${a}`);
    }
  });

  h.mockOnly(it, 'C-PERM-08(mock-only): 同班の別職長は編集可・他班は不可・team空は本人のみ', async () => {
    await h.mock('patch', { sheet: 'Users', insert: { userId: 'u_tanaka2', name: '田中二', role: 'foreman', status: 'active' } });
    await h.mock('patch', { sheet: 'Users', insert: { userId: 'u_other', name: '別班', role: 'foreman', status: 'active' } });
    await h.mock('patch', { sheet: 'Users', insert: { userId: 'u_noteam', name: '班なし', role: 'foreman', status: 'active' } });
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_tanaka2', assignRole: 'subforeman', team: '田中班' } });
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_other', assignRole: 'foreman', team: '別班' } });
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_noteam', assignRole: 'foreman' } });
    const mk = async (userId) => { const d = await h.mock('issueDevice', { userId }); return new h.Session(userId, d.deviceToken, d.deviceId); };
    const t2 = await mk('u_tanaka2'); const ot = await mk('u_other'); const nt = await mk('u_noteam');
    const patch = [{ itemId: 'i1', result: 'ok' }];
    assert.equal((await t2.call('saveDraft', { recordId: SEED.a3, items: patch })).ok, true, '同班(副職長)は編集可');
    assert.equal((await t2.call('getRecord', { recordId: SEED.a3 })).ok, true);
    assert.equal((await ot.call('saveDraft', { recordId: SEED.a3, items: patch })).error.code, 'FORBIDDEN_TEAM');
    assert.equal((await ot.call('getRecord', { recordId: SEED.a3 })).error.code, 'FORBIDDEN_TEAM');
    assert.equal((await ot.ok('listRecords', { siteId: 's_a' })).records.find((r) => r.recordId === SEED.a3).masked, true);
    assert.equal((await nt.call('saveDraft', { recordId: SEED.a3, items: patch })).error.code, 'FORBIDDEN_TEAM', 'team空の職長は他人の記録を編集できない');
    const own = await h.createRecordFor(nt, { siteId: 's_a', lot: 'NT1' });
    assert.equal(own.res.ok, true);
    assert.equal((await nt.call('saveDraft', { recordId: own.recordId, items: patch })).ok, true, '本人の記録は編集可');
    assert.equal((await t2.call('saveDraft', { recordId: own.recordId, items: patch })).error.code, 'FORBIDDEN_TEAM');
  });

  it('C-PERM-09: 参加申請・承認・不在時の代行承認・取消・合言葉更新', async () => {
    const sg = await h.login('u_sugiant');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const sees = async () => (await sg.ok('getBootstrap', {})).sites.map((s) => s.siteId);
    assert.ok(!(await sees()).includes('s_a'));
    assert.equal((await sg.call('requestJoin', { siteId: 's_a', joinKey: 'wrongkey' })).error.code, 'JOIN_KEY_INVALID');
    const req = await sg.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' });
    assert.equal(req.ok, true, JSON.stringify(req.error));
    assert.equal(req.data.membership.status, 'pending');
    const again = await sg.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' });
    assert.equal(again.error.code, 'JOIN_PENDING');
    assert.equal(again.error.data.membershipId, req.data.membership.membershipId);
    const mid = req.data.membership.membershipId;
    // 主担当在席中: 代行者は不可
    const find = async (s) => (await s.ok('listJoinRequests', {})).requests.find((m) => m.membershipId === mid);
    assert.equal((await find(sato)).canDecide, true);
    assert.equal((await find(suzuki)).canDecide, false);
    assert.equal((await find(lead)).canDecide, true);
    assert.equal((await suzuki.call('decideJoin', { membershipId: mid, decision: 'approve', team: 'ス班' })).error.code, 'FORBIDDEN_ROLE');
    assert.equal((await sato.call('decideJoin', { membershipId: mid, decision: 'approve' })).error.code, 'VALIDATION_FAILED', 'approve は team 必須');
    const ap = await sato.call('decideJoin', { membershipId: mid, decision: 'approve', team: 'スギアント班' });
    assert.equal(ap.ok, true, JSON.stringify(ap.error));
    assert.equal(ap.data.membership.status, 'approved');
    assert.equal(ap.data.assignment.effective, true);
    assert.ok((await sees()).includes('s_a'), '承認で現場が見える');
    const asg = (await suzuki.ok('listAssignments', { siteId: 's_a' })).assignments;
    assert.ok(asg.some((a) => a.userId === 'u_sugiant' && a.assignRole === 'foreman' && a.effective));
    // 取消
    assert.equal((await sato.call('revokeMembership', { membershipId: mid, reason: '' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await sato.call('revokeMembership', { membershipId: mid, reason: '異動' })).ok, true);
    assert.ok(!(await sees()).includes('s_a'), '取消で見えなくなる');
    // 主担当が不在登録中なら代行者が承認できる
    const today = h.jstDate(await h.serverNow());
    const ab = await lead.call('adminSetAbsence', { userId: 'u_sato', dateFrom: today, dateTo: today, reason: '休み' });
    assert.equal(ab.ok, true, JSON.stringify(ab.error));
    const req2 = await sg.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' });
    assert.equal(req2.ok, true, JSON.stringify(req2.error));
    const mid2 = req2.data.membership.membershipId;
    const ap2 = await suzuki.call('decideJoin', { membershipId: mid2, decision: 'approve', team: 'スギアント班' });
    assert.equal(ap2.ok, true, JSON.stringify(ap2.error));
    assert.ok((await sees()).includes('s_a'));
    // 責任者は常に可
    assert.equal((await lead.call('revokeMembership', { membershipId: mid2, reason: '再申請' })).ok, true);
    const req3 = await sg.ok('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' });
    assert.equal((await lead.call('decideJoin', { membershipId: req3.membership.membershipId, decision: 'approve', team: 'ス班', assignRole: 'subforeman' })).ok, true);
    // 合言葉更新で旧キーは無効
    const rot = await lead.ok('adminRotateJoinKey', { siteId: 's_a' });
    assert.notEqual(rot.joinKey, 'joinkeyaaaaaaaa1');
    const t = await h.login('u_tanaka');
    assert.equal((await t.call('requestJoin', { siteId: 's_a', joinKey: 'joinkeyaaaaaaaa1' })).error.code, 'JOIN_KEY_INVALID');
  });

  h.mockOnly(it, 'C-PERM-10(mock-only): 無効な担当・役割不整合は権限を与えない(兼任なしの強制)', async () => {
    const rows = await h.stateRows('Assignments');
    const idOf = (siteId, userId) => rows.find((r) => r.siteId === siteId && r.userId === userId).assignId;
    const t = await h.login('u_tanaka');
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).ok, true);
    await h.mock('patch', { sheet: 'Assignments', key: idOf('s_a', 'u_tanaka'), set: { active: false } });
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).error.code, 'FORBIDDEN_SITE', 'active=FALSE');
    await h.mock('patch', { sheet: 'Assignments', key: idOf('s_a', 'u_tanaka'), set: { active: true, validTo: '2026-01-02' } });
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).error.code, 'FORBIDDEN_SITE', '期間外');
    await h.mock('patch', { sheet: 'Assignments', key: idOf('s_a', 'u_tanaka'), set: { validTo: null } });
    assert.equal((await t.call('listRecords', { siteId: 's_a' })).ok, true, '戻すと復帰');
    // 役割不整合
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_c', userId: 'u_sato', assignRole: 'foreman', team: 'X' } });
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_c', userId: 'u_tanaka', assignRole: 'qa_sub' } });
    const qa = await h.login('u_sato');
    assert.equal((await qa.call('claimReview', { recordId: SEED.c2, round: 1 })).error.code, 'FORBIDDEN_SITE', 'QAに職長担当を付けても現場に入れない');
    assert.equal((await t.call('getRecord', { recordId: SEED.c2 })).error.code, 'FORBIDDEN_SITE', '職長にQA担当を付けても入れない');
    assert.equal((await t.call('claimReview', { recordId: SEED.c2, round: 1 })).error.code, 'FORBIDDEN_ROLE');
  });
});
