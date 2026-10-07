// C-CONC-01〜03: 同時操作
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

describe('C-CONC 同時操作', () => {
  beforeEach(() => h.reset());

  it('C-CONC-01: 2人のQAが同時に claimReview → 先着1件のみ成功(20回)', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    for (let i = 0; i < 20; i++) {
      const { recordId } = await h.makeSubmitted(t, { siteId: 's_a', floor: '1F' });
      const [a, b] = await Promise.all([sato.call('claimReview', { recordId, round: 1 }), suzuki.call('claimReview', { recordId, round: 1 })]);
      const wins = [[sato, a], [suzuki, b]].filter(([, r]) => r.ok);
      const losses = [[sato, a], [suzuki, b]].filter(([, r]) => !r.ok);
      assert.equal(wins.length, 1, `回${i}: 成功はちょうど1件`);
      assert.equal(losses.length, 1);
      const [winner] = wins[0];
      assert.equal(losses[0][1].error.code, 'ALREADY_CLAIMED');
      assert.equal(losses[0][1].error.data.claimedBy, winner.userId);
      assert.equal(typeof losses[0][1].error.data.claimedByName, 'string');
      assert.equal((await h.getRecord(t, recordId)).claimedBy, winner.userId);
    }
  });

  it('C-CONC-02: 30分未満の引き継ぎは TAKEOVER_NOT_ALLOWED(availableAt)。責任者は即時可', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const { recordId } = await h.makeSubmitted(t);
    assert.equal((await suzuki.call('takeoverReview', { recordId, round: 1 })).error.code, 'NOT_CLAIMED');
    const c = await sato.ok('claimReview', { recordId, round: 1 });
    const r = await suzuki.call('takeoverReview', { recordId, round: 1 });
    assert.equal(r.error.code, 'TAKEOVER_NOT_ALLOWED');
    const avail = Date.parse(r.error.data.availableAt);
    assert.ok(Math.abs(avail - (Date.parse(c.record.claimedAt) + 30 * 60000)) < 5000, 'availableAt = claimedAt + 30分');
    const lt = await lead.call('takeoverReview', { recordId, round: 1 });
    assert.equal(lt.ok, true, JSON.stringify(lt.error));
    assert.equal(lt.data.record.claimedBy, 'u_lead');
    assert.equal((await sato.call('saveQaDraft', { recordId, comment: 'x' })).error.code, 'NOT_CLAIMER', '引き継がれた元のQAは書けない');
  });
  h.mockOnly(it, 'C-CONC-02(mock-only): 時計+31分で担当QAも引き継げる(Eventsにfrom)', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const { recordId } = await h.makeSubmitted(t);
    await sato.ok('claimReview', { recordId, round: 1 });
    await h.mock('clock', { advanceMin: 31 });
    const r = await suzuki.call('takeoverReview', { recordId, round: 1 });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.record.claimedBy, 'u_suzuki');
    const ev = (await h.getRecord(suzuki, recordId)).events.find((e) => e.kind === 'claim_taken_over');
    assert.equal(ev.detail.from, 'u_sato');
  });
  it('C-CONC-02: claim者が不在登録中なら即時に引き継げる', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const { recordId } = await h.makeSubmitted(t);
    await sato.ok('claimReview', { recordId, round: 1 });
    assert.equal((await suzuki.call('takeoverReview', { recordId, round: 1 })).error.code, 'TAKEOVER_NOT_ALLOWED');
    const today = h.jstDate(await h.serverNow());
    await lead.ok('adminSetAbsence', { userId: 'u_sato', dateFrom: today, dateTo: today });
    const r = await suzuki.call('takeoverReview', { recordId, round: 1 });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  });

  h.mockOnly(it, 'C-CONC-03(mock-only): 同班2人の saveDraft は項目×列の後勝ちで欠落しない', async () => {
    await h.mock('patch', { sheet: 'Users', insert: { userId: 'u_tanaka2', name: '田中二', role: 'foreman', status: 'active' } });
    await h.mock('patch', { sheet: 'Assignments', insert: { siteId: 's_a', userId: 'u_tanaka2', assignRole: 'subforeman', team: '田中班' } });
    const d = await h.mock('issueDevice', { userId: 'u_tanaka2' });
    const t2 = new h.Session('u_tanaka2', d.deviceToken, d.deviceId);
    const t1 = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t1, { siteId: 's_a', floor: '1F', lot: 'CC3' });
    // 交互(順序固定): i1 を ok→ng(後勝ち)、i2/i3 は互いに残る
    await t1.ok('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ok' }, { itemId: 'i2', result: 'ok', note: 'A' }] });
    await t2.ok('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ng' }, { itemId: 'i3', result: 'na' }] });
    await t1.ok('saveDraft', { recordId, items: [{ itemId: 'i4', result: 'ok', values: [1, -1] }] });
    let rec = await h.getRecord(t1, recordId);
    const get = (id) => rec.items.find((i) => i.itemId === id).self;
    assert.equal(get('i1').result, 'ng'); assert.equal(get('i2').result, 'ok'); assert.equal(get('i2').note, 'A');
    assert.equal(get('i3').result, 'na'); assert.deepEqual(get('i4').values, [1, -1]);
    // 同時(並行)送信でも別項目は欠落しない
    await Promise.all([
      t1.ok('saveDraft', { recordId, items: [{ itemId: 'i5', result: 'ok' }, { itemId: 'i6', result: 'ok' }] }),
      t2.ok('saveDraft', { recordId, items: [{ itemId: 'i7', result: 'ok' }, { itemId: 'i8', result: 'ng', note: 'B' }] }),
    ]);
    rec = await h.getRecord(t2, recordId);
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8']) assert.ok(get(id).result, `${id} が残っている`);
    assert.equal(get('i8').note, 'B');
    // 列単位: 片方が note だけ、もう片方が result だけを更新しても互いを消さない
    await t1.ok('saveDraft', { recordId, items: [{ itemId: 'i9', note: 'メモ' }] });
    await t2.ok('saveDraft', { recordId, items: [{ itemId: 'i9', result: 'ng' }] });
    rec = await h.getRecord(t1, recordId);
    assert.equal(get('i9').note, 'メモ'); assert.equal(get('i9').result, 'ng');
  });
});
