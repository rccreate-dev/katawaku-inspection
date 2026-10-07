// C-TIME-01〜04: 時間ルール・通知
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const SEED = { a2: 'r_seeda20000000000', c2: 'r_seedc20000000000' };

describe('C-TIME 時間ルール・通知', () => {
  beforeEach(() => h.reset());

  it('C-TIME-01: シードの a2(40分)=escLevel 1、c2(70分)=2', async () => {
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    const list = (await lead.ok('listRecords', {})).records;
    assert.equal(list.find((r) => r.recordId === SEED.a2).escLevel, 1);
    assert.equal(list.find((r) => r.recordId === SEED.c2).escLevel, 2);
    const mine = (await t.ok('listRecords', { siteId: 's_a' })).records;
    assert.equal(mine.find((r) => r.recordId === SEED.a2).escLevel, 1);
    assert.equal((await h.getRecord(lead, SEED.c2)).escLevel, 2);
  });
  h.mockOnly(it, 'C-TIME-01(mock-only): 時計を進めると 0→1→2、claim された時点で凍結', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const lvl = async (id) => (await h.getRecord(qa, id)).escLevel;
    const { recordId } = await h.makeSubmitted(t);
    const { recordId: frozen } = await h.makeSubmitted(t);
    assert.equal(await lvl(recordId), 0);
    await h.mock('clock', { advanceMin: 29 });
    assert.equal(await lvl(recordId), 0);
    await h.mock('clock', { advanceMin: 2 });
    assert.equal(await lvl(recordId), 1);
    await qa.ok('claimReview', { recordId: frozen, round: 1 });
    await h.mock('clock', { advanceMin: 30 });
    assert.equal(await lvl(recordId), 2);
    assert.equal(await lvl(frozen), 1, 'claim時点で凍結');
    await h.mock('clock', { advanceMin: 120 });
    assert.equal(await lvl(frozen), 1);
    assert.equal((await h.getRecord(qa, SEED.a2)).escLevel, 2);
  });

  h.mockOnly(it, 'C-TIME-02(mock-only): tick で escalate_30/60 が1回ずつ・宛先規則・再提出で escNotified が0に戻る', async () => {
    await h.mock('tick', {});
    const count = async (id, kind) => (await h.eventsOf(id)).filter((e) => e.kind === kind);
    const a30 = await count(SEED.a2, 'escalate_30');
    assert.equal(a30.length, 1);
    assert.deepEqual(a30[0].detail.to, ['u_suzuki'], 'a2: 代行者(鈴木)へ');
    assert.equal((await count(SEED.a2, 'escalate_60')).length, 0);
    const c30 = await count(SEED.c2, 'escalate_30'); const c60 = await count(SEED.c2, 'escalate_60');
    assert.equal(c30.length, 1); assert.equal(c60.length, 1);
    assert.deepEqual(c60[0].detail.to, ['u_lead'], '60分は責任者へ');
    await h.mock('tick', {}); await h.mock('tick', {});
    assert.equal((await count(SEED.a2, 'escalate_30')).length, 1, '再tickしても増えない');
    assert.equal((await count(SEED.c2, 'escalate_60')).length, 1);
    const mails = await h.mailsList();
    const forA = mails.filter((m) => m.body.includes(SEED.a2));
    assert.equal(forA.length, 1);
    assert.equal(forA[0].to, 'suzuki@example.test');
    assert.ok(forA[0].subject.startsWith('[型枠検査]'));
    const forC = mails.filter((m) => m.body.includes(SEED.c2));
    assert.equal(forC.length, 2);
    assert.ok(forC.every((m) => m.to === 'lead@example.test'));
    const rows = await h.stateRows('Records');
    assert.equal(rows.find((r) => r.recordId === SEED.a2).escNotified, 1);
    assert.equal(rows.find((r) => r.recordId === SEED.c2).escNotified, 2);
    // 再提出で escNotified が0に戻る
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeSubmitted(t);
    await h.mock('clock', { advanceMin: 31 });
    await h.mock('tick', {});
    assert.equal((await h.stateRows('Records')).find((r) => r.recordId === recordId).escNotified, 1);
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
    await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    await t.ok('saveDraft', { recordId, items: [{ itemId: 'i10', result: 'ok' }] });
    await t.ok('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal((await h.stateRows('Records')).find((r) => r.recordId === recordId).escNotified, 0);
    // 提出メール(主担当QA宛)
    const sub = (await h.mailsList()).filter((m) => m.body.includes(recordId) && m.subject.includes('提出'));
    assert.ok(sub.length >= 2 && sub.every((m) => m.to === 'sato@example.test'));
  });

  h.mockOnly(it, 'C-TIME-03(mock-only): timing の値(§6.5)と SELF_LATE / QA_BEFORE_OPEN / QA_LATE(いずれも成功する)', async () => {
    await h.reset({ now: '2026-10-07T10:00:00+09:00' });
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const planned = '2026-10-08T09:00:00+09:00';
    const { recordId } = await h.makeFilledDraft(t, { siteId: 's_a', floor: '1F', lot: 'TM1', pourPlannedAt: planned });
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.timing.selfDeadlineAt, '2026-10-07T15:00:00+09:00');
    assert.equal(rec.timing.qaOpenAt, '2026-10-07T16:00:00+09:00');
    assert.equal(rec.timing.qaDeadlineAt, '2026-10-08T07:00:00+09:00');
    assert.equal(rec.timing.selfLate, false); assert.equal(rec.timing.qaLate, false);
    // 前日15:00超過で提出 → SELF_LATE(成功)
    await h.mock('clock', { set: '2026-10-07T15:30:00+09:00' });
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.timing.selfLate, true, '未提出で期限超過');
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.ok, true, JSON.stringify(sub.error));
    assert.deepEqual(sub.data.warnings, ['SELF_LATE']);
    // 16:00前の判定 → QA_BEFORE_OPEN(成功)
    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId, { i10: { result: 'ng', severity: 'minor', note: 'x' } }, { comment: 'c' });
    const v = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'minor' });
    assert.equal(v.ok, true, JSON.stringify(v.error));
    assert.ok(v.data.warnings.includes('QA_BEFORE_OPEN'));
    assert.ok(!v.data.warnings.includes('QA_LATE'));
    rec = await h.getRecord(t, recordId);
    assert.equal(rec.timing.selfLate, true, 'firstSubmittedAt が期限超過');
    // 打設2時間前超過 → QA_LATE(成功)。提出は期限内
    await h.reset({ now: '2026-10-07T10:00:00+09:00' });
    const t2 = await h.login('u_tanaka'); const qa2 = await h.login('u_sato');
    const { recordId: r2 } = await h.makeSubmitted(t2, { siteId: 's_a', floor: '1F', lot: 'TM2', pourPlannedAt: planned });
    await qa2.ok('claimReview', { recordId: r2, round: 1 });
    await h.fillQa(qa2, r2);
    await h.mock('clock', { set: '2026-10-08T07:30:00+09:00' });
    assert.equal((await h.getRecord(qa2, r2)).timing.qaLate, true);
    const v2 = await qa2.call('submitVerdict', { recordId: r2, round: 1, verdict: 'ok' }, { pin: qa2.pin });
    assert.equal(v2.ok, true, JSON.stringify(v2.error));
    assert.deepEqual(v2.data.warnings, ['QA_LATE']);
    assert.equal((await h.getRecord(qa2, r2)).timing.qaLate, true, '判定時刻が期限超過');
    // 予定なし → null/false
    const t3 = await h.login('u_tanaka');
    const none = await h.createRecordFor(t3, { siteId: 's_a', floor: '2F', lot: 'TM3', pourPlannedAt: null });
    assert.deepEqual((await h.getRecord(t3, none.recordId)).timing, { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false });
  });

  it('C-TIME-04: 不在登録中の主担当は listAssignments.absentToday と Site.qa.mainAbsent に反映', async () => {
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    const today = h.jstDate(await h.serverNow());
    const before = (await t.ok('getBootstrap', {})).sites.find((s) => s.siteId === 's_a');
    assert.equal(before.qa.mainAbsent, false);
    assert.equal(before.qa.main.userId, 'u_sato');
    assert.deepEqual(before.qa.subs.map((u) => u.userId), ['u_suzuki']);
    const ab = await lead.ok('adminSetAbsence', { userId: 'u_sato', dateFrom: today, dateTo: today, reason: '休暇' });
    const asg = (await lead.ok('listAssignments', { siteId: 's_a' })).assignments;
    assert.equal(asg.find((a) => a.userId === 'u_sato').absentToday, true);
    assert.equal(asg.find((a) => a.userId === 'u_suzuki').absentToday, false);
    const b = (await t.ok('getBootstrap', {})).sites;
    assert.equal(b.find((s) => s.siteId === 's_a').qa.mainAbsent, true);
    assert.equal(b.find((s) => s.siteId === 's_b').qa.mainAbsent, true, '佐藤は s_b の主担当でもある');
    await lead.ok('adminCancelAbsence', { absenceId: ab.absence.absenceId });
    assert.equal((await t.ok('getBootstrap', {})).sites.find((s) => s.siteId === 's_a').qa.mainAbsent, false);
    const qaAsg = (await (await h.login('u_sato')).ok('listAssignments', {})).assignments;
    assert.ok(qaAsg.every((a) => a.siteId !== 's_c'), 'QAは担当現場の担当表のみ');
  });
});
