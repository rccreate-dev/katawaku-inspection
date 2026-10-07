// C-IDEM-01〜05: 冪等キー
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const countKind = (rec, kind) => rec.events.filter((e) => e.kind === kind).length;

describe('C-IDEM 冪等キー', () => {
  beforeEach(() => h.reset());

  it('C-IDEM-01: submitRecord/submitVerdict/recordPrimeSign の再送は replayed=true・同一data・Events1回分', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeFilledDraft(t);
    const cid1 = h.newClientId();
    const a = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid1 });
    const b = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid1 });
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.equal(a.meta.replayed, false); assert.equal(b.meta.replayed, true);
    assert.deepEqual(b.data, a.data);
    let rec = await h.getRecord(qa, recordId);
    assert.equal(countKind(rec, 'submitted'), 1); assert.equal(rec.round, 1); assert.equal(rec.status, 'submitted');

    await qa.ok('claimReview', { recordId, round: 1 });
    await h.fillQa(qa, recordId);
    const cid2 = h.newClientId();
    const v1 = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin, clientId: cid2 });
    const v2 = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin, clientId: cid2 });
    assert.equal(v1.ok, true); assert.equal(v2.meta.replayed, true); assert.deepEqual(v2.data, v1.data);
    const cid3 = h.newClientId();
    const p1 = await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin, clientId: cid3 });
    const p2 = await qa.call('recordPrimeSign', { recordId, signerName: '山田', method: 'paper' }, { pin: qa.pin, clientId: cid3 });
    assert.equal(p1.ok, true); assert.equal(p2.meta.replayed, true); assert.deepEqual(p2.data, p1.data);
    rec = await h.getRecord(qa, recordId);
    assert.equal(countKind(rec, 'verdict_ok'), 1); assert.equal(countKind(rec, 'prime_signed'), 1);
    assert.equal(rec.round, 1); assert.equal(rec.status, 'approved');
  });

  it('C-IDEM-02: 同一clientIdで内容違い・別ユーザーは IDEMPOTENCY_CONFLICT', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.createRecordFor(t, { lot: 'ID2' });
    const cid = h.newClientId();
    assert.equal((await t.call('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ok' }] }, { clientId: cid })).ok, true);
    const r = await t.call('saveDraft', { recordId, items: [{ itemId: 'i1', result: 'ng' }] }, { clientId: cid });
    assert.equal(r.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await t.call('addNote', { recordId, text: 'x' }, { clientId: cid })).error.code, 'IDEMPOTENCY_CONFLICT', 'action違い');
    assert.equal((await qa.call('releaseClaim', { recordId }, { clientId: cid })).error.code, 'IDEMPOTENCY_CONFLICT', '別ユーザー');
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.items.find((i) => i.itemId === 'i1').self.result, 'ok', '競合した内容は適用されない');
  });

  it('C-IDEM-03: createRecord/claimReview の再送が成功。saveDraft・addNote の再送で重複しない', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const recordId = h.newRecordId();
    const params = { recordId, siteId: 's_a', floor: '1F', zone: '', lot: 'ID3', stage: 'pre_pour', pourPlannedAt: await h.pourPlanned() };
    const cid = h.newClientId();
    const c1 = await t.call('createRecord', params, { clientId: cid });
    const c2 = await t.call('createRecord', params, { clientId: cid });
    assert.equal(c1.ok, true); assert.equal(c2.ok, true, JSON.stringify(c2.error)); assert.equal(c2.meta.replayed, true);
    assert.equal(c2.data.record.recordId, recordId);
    const c3 = await t.call('createRecord', params); // 別clientIdでも同一recordId・同一ユーザーなら冪等成功
    assert.equal(c3.ok, true, JSON.stringify(c3.error));
    const list = await t.ok('listRecords', { siteId: 's_a' });
    assert.equal(list.records.filter((r) => r.lot === 'ID3').length, 1);

    const sd = h.newClientId();
    const items = [{ itemId: 'i1', result: 'ng', note: 'メモ', values: [] }];
    const s1 = await t.call('saveDraft', { recordId, items }, { clientId: sd });
    const s2 = await t.call('saveDraft', { recordId, items }, { clientId: sd });
    assert.equal(s1.ok, true); assert.equal(s2.meta.replayed, true);
    const nid = h.newClientId();
    const n1 = await t.call('addNote', { recordId, text: '追記' }, { clientId: nid });
    const n2 = await t.call('addNote', { recordId, text: '追記' }, { clientId: nid });
    assert.equal(n1.ok, true); assert.equal(n2.meta.replayed, true); assert.equal(n2.data.note.noteId, n1.data.note.noteId);
    const rec = await h.getRecord(t, recordId);
    assert.equal(rec.notes.filter((n) => n.text === '追記').length, 1);
    assert.equal(rec.items.length, 16);

    const { recordId: sub } = await h.makeSubmitted(t);
    const cl = h.newClientId();
    const k1 = await qa.call('claimReview', { recordId: sub, round: 1 }, { clientId: cl });
    const k2 = await qa.call('claimReview', { recordId: sub, round: 1 }, { clientId: cl });
    assert.equal(k1.ok, true); assert.equal(k2.ok, true, JSON.stringify(k2.error)); assert.equal(k2.meta.replayed, true);
    assert.equal(k2.data.record.claimedBy, 'u_sato');
    assert.equal(countKind(await h.getRecord(qa, sub), 'claimed'), 1);
  });

  it('C-IDEM-04: 検証エラーで失敗した clientId は保存されず、直した内容で再送すると成功', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'ID4' });
    const cid = h.newClientId();
    const bad = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid });
    assert.equal(bad.error.code, 'VALIDATION_FAILED');
    await t.ok('saveDraft', { recordId, items: h.okPatches() });
    for (const id of h.KEY_ITEMS) await h.uploadPhoto(t, { recordId, itemId: id, side: 'self' });
    const good = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid });
    assert.equal(good.ok, true, JSON.stringify(good.error));
    assert.equal(good.meta.replayed, false);
  });

  h.mockOnly(it, 'C-IDEM-05(mock-only): 応答喪失(処理完了後に切断)→同じclientIdで再送しても二重にならない', async () => {
    const t = await h.login('u_tanaka');
    const { recordId } = await h.makeFilledDraft(t);
    // submitRecord
    await h.mock('fail', { next: 1, mode: 'network', after: true, match: 'submitRecord' });
    const cid = h.newClientId();
    await assert.rejects(() => t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid }), /fetch failed|terminated|other side closed|socket/i);
    const r = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin, clientId: cid });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.meta.replayed, true);
    let rec = await h.getRecord(t, recordId);
    assert.equal(rec.round, 1); assert.equal(rec.status, 'submitted');
    assert.equal(countKind(rec, 'submitted'), 1);
    const events = await h.eventsOf(recordId);
    assert.equal(events.filter((e) => e.kind === 'submitted').length, 1);
    // addNote(Notesの二重化がない)
    const { recordId: d } = await h.createRecordFor(t, { lot: 'ID5' });
    await h.mock('fail', { next: 1, mode: 'network', after: true, match: 'addNote' });
    const nid = h.newClientId();
    await assert.rejects(() => t.call('addNote', { recordId: d, text: '一回だけ' }, { clientId: nid }));
    const n = await t.call('addNote', { recordId: d, text: '一回だけ' }, { clientId: nid });
    assert.equal(n.ok, true); assert.equal(n.meta.replayed, true);
    rec = await h.getRecord(t, d);
    assert.equal(rec.notes.filter((x) => x.text === '一回だけ').length, 1);
    assert.equal((await h.stateRows('Notes')).filter((x) => x.text === '一回だけ').length, 1);
    // 処理前に失敗させた場合は再送で通常成功(replayed=false)
    await h.mock('fail', { next: 1, mode: 'http500', match: 'saveDraft' });
    const sid = h.newClientId();
    const f = await h.post({ v: 1, action: 'saveDraft', clientId: sid, deviceToken: t.token, appVersion: '1.0.0', params: { recordId: d, items: [{ itemId: 'i1', result: 'ok' }] } });
    assert.equal(f.status, 500);
    const s = await t.call('saveDraft', { recordId: d, items: [{ itemId: 'i1', result: 'ok' }] }, { clientId: sid });
    assert.equal(s.ok, true); assert.equal(s.meta.replayed, false);
  });
});
